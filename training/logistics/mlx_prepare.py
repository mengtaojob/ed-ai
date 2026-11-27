"""把物流 ShareGPT 正例按助理的回答步骤转换成 MLX-LM 聊天数据。"""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from mlx_lm.tokenizer_utils import load
from mlx_lm.tuner.datasets import ChatDataset
import yaml

from evaluate import replay_prefix
from validate import ROOT, parse_example, read_split, require, validate_all


def examples(row):
    """每行末尾只放一次要学习的动作，前面的对话和工具返回作为模型输入。"""
    turns, index, call, _ = parse_example(row)
    prefix = replay_prefix(row, turns, index)
    tools = [{"type": "function", "function": tool} for tool in json.loads(row["tools"])]
    if index > 1:
        yield "clarification", {"messages": prefix[:3], "tools": tools}

    request = {
        "role": "assistant", "content": "",
        "tool_calls": [{"type": "function", "function": call}],
    }
    yield "tool_call", {"messages": [*prefix, request], "tools": tools}
    result = {"role": "tool", "content": turns[index + 1]["value"]}
    answer = {"role": "assistant", "content": turns[-1]["value"]}
    yield "final_reply", {"messages": [*prefix, request, result, answer], "tools": tools}


def audit_example(dataset, sample, stage, case_id, max_length):
    """用训练器自己的分词和掩码检查目标，并确认完整工具结果在掩码内。"""
    messages = sample["messages"]
    tokenizer = dataset.tokenizer
    tokens, offset = dataset.process(sample)
    prefix = tokenizer.apply_chat_template(
        messages[:-1], tools=sample["tools"], add_generation_prompt=True,
        enable_thinking=False, return_dict=False,
    )
    require(0 < offset <= len(prefix) < len(tokens) <= max_length,
            f"{case_id}/{stage} 的监督区间或长度不符，实际 {len(tokens)}，上限 {max_length}")
    require(prefix == tokens[:len(prefix)], f"{case_id}/{stage} 推理前缀与训练序列不一致")
    target = tokenizer.decode(tokens[len(prefix):])
    if stage == "tool_call":
        opening, closing = tokenizer.tool_call_start, tokenizer.tool_call_end
        _, start, remainder = target.partition(opening)
        body, end, _ = remainder.partition(closing)
        require(start and end, f"{case_id} 的工具调用缺少完整标签")
        parsed = tokenizer.tool_parser(body.strip(), sample["tools"])
        require(parsed == messages[-1]["tool_calls"][0]["function"],
                f"{case_id} 的完整工具调用必须出现在监督区间")
    else:
        require(messages[-1]["content"] in target, f"{case_id}/{stage} 的回答未完整监督")
    if stage == "final_reply":
        require(messages[-2]["content"] in tokenizer.decode(tokens[:offset]),
                f"{case_id} 的完整工具返回必须作为提示词")
    return {"case_id": case_id, "stage": stage, "tokens": len(tokens), "masked_prefix_tokens": offset,
            "assistant_tokens_with_eos": len(tokens) - offset}


def main(config):
    validate_all()
    require(config["mask_prompt"], "必须开启掩码，只训练最后一条助理消息")
    tokenizer = load(Path(config["model"]))
    datasets = {}
    for source, output in (("train", "train.jsonl"), ("validation", "valid.jsonl")):
        rows = read_split(source)
        items = [(row["metadata"]["case_id"], stage, sample)
                 for row in rows for stage, sample in examples(row)]
        dataset = ChatDataset([sample for _, _, sample in items], tokenizer, mask_prompt=True)
        audits = [audit_example(dataset, sample, stage, case_id, config["max_seq_length"])
                  for case_id, stage, sample in items]
        datasets[output] = ([sample for _, _, sample in items], {
            "source_sha256": sha256((ROOT / f"{source}.json").read_bytes()).hexdigest(),
            "source_dialogues": len(rows),
            "stage_counts": dict(Counter(audit["stage"] for audit in audits)),
            "max_tokens": max(audit["tokens"] for audit in audits),
            "examples": audits,
        })

    destination = Path(config["data"])
    destination.mkdir(parents=True, exist_ok=True)
    for output, (samples, audit) in datasets.items():
        (destination / output).write_text(
            "".join(json.dumps(sample, ensure_ascii=False) + "\n" for sample in samples), encoding="utf-8",
        )
        print(f"{output}: {audit['source_dialogues']} 条原对话，{len(samples)} 个监督目标，"
              f"最长 {audit['max_tokens']}/{config['max_seq_length']} tokens，{audit['stage_counts']}")
    report = {"max_seq_length": config["max_seq_length"], "splits": {
        output: audit for output, (_, audit) in datasets.items()
    }}
    (destination / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("qlora/logistics-mlx.yaml"))
    args = parser.parse_args()
    main(yaml.safe_load(args.config.read_text(encoding="utf-8")))
