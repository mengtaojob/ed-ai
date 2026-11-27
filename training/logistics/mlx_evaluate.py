"""在本地 MLX 上回放物流验收题，沿用现有工具调用和回复评分。"""

import argparse
from datetime import datetime, timezone
from hashlib import file_digest
from importlib.metadata import version
import json
from pathlib import Path
import re

import mlx.core as mx
from mlx.utils import tree_flatten
from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler

from evaluate import run_case, summarize
from validate import ROOT, read_split, require, validate_all

SETTINGS = {"temperature": 0, "max_tokens": 256, "enable_thinking": False, "seed": 42}


def sha256_file(path):
    with path.open("rb") as file:
        return file_digest(file, "sha256").hexdigest()


def verify_adapter(model, adapter):
    """检查保存的 LoRA 张量确实等于加载后的模型参数，并确认有权重被更新。"""
    path = adapter / "adapters.safetensors"
    saved = mx.load(str(path))
    loaded = dict(tree_flatten(model.parameters()))
    require(bool(saved) and all(name in loaded for name in saved), "模型没有挂载保存的 LoRA 参数")
    matches = mx.stack([mx.array_equal(array, loaded[name]) for name, array in saved.items()])
    updated = [mx.any(array != 0) for name, array in saved.items() if name.endswith(".lora_b")]
    require(mx.all(matches).item() and updated and mx.any(mx.stack(updated)).item(),
            "适配器权重未正确加载或 LoRA B 仍全部为零")
    return {"path": str(path), "sha256": sha256_file(path), "loaded_tensors": len(saved),
            "nonzero_lora_b_tensors": sum(mx.stack(updated).tolist())}


def model_reply(model, tokenizer, sampler, messages, tools):
    """把旧评估器的 OpenAI 消息转给 Qwen 模板，留下生成原文供人工复核。"""
    history = []
    for message in messages:
        if message.get("tool_calls"):
            calls = [
                {**call, "function": {**call["function"], "arguments": json.loads(call["function"]["arguments"])}}
                for call in message["tool_calls"]
            ]
            message = {**message, "tool_calls": calls}
        history.append(message)
    prompt = tokenizer.apply_chat_template(
        history, tools=tools, add_generation_prompt=True,
        enable_thinking=SETTINGS["enable_thinking"], return_dict=False,
    )
    fragments = []
    for response in stream_generate(model, tokenizer, prompt, max_tokens=SETTINGS["max_tokens"], sampler=sampler):
        fragments.append(response.text)
    raw = "".join(fragments)

    # Qwen 用工具标签包住调用，交给 MLX 自带解析器还原成原评分脚本的字段。
    start, end = tokenizer.tool_call_start, tokenizer.tool_call_end
    pattern = re.compile(re.escape(start) + r"(.*?)" + re.escape(end), re.DOTALL)
    tool_calls = []
    errors = []
    for match in pattern.finditer(raw):
        try:
            call = tokenizer.tool_parser(match[1].strip(), tools)
            tool_calls.append({"type": "function", "function": {
                "name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False),
            }})
        except (ValueError, KeyError) as error:
            errors.append(str(error))
    spoken = pattern.sub("", raw).strip()
    if start in spoken or end in spoken:
        errors.append("生成的工具调用标签不完整")
    return {"text": spoken, "raw_text": raw, "tool_calls": tool_calls, "tool_parse_errors": errors,
            "finish_reason": response.finish_reason}


def main(args):
    validate_all()
    mx.set_default_device(mx.gpu)
    mx.random.seed(SETTINGS["seed"])
    identity = {name: sha256_file(args.model / name) for name in (
        "model.safetensors", "config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja",
    )}
    model, tokenizer = load(args.model, adapter_path=str(args.adapter) if args.adapter else None)
    require(tokenizer.tool_parser is not None, "MLX 未识别 Qwen 的工具调用模板")
    adapter_info = verify_adapter(model, args.adapter) if args.adapter else None
    sampler = make_sampler(temp=SETTINGS["temperature"])

    def reply(messages, tools):
        return model_reply(model, tokenizer, sampler, messages, tools)

    results = []
    for row in read_split("acceptance"):
        case = run_case(row, reply)
        results.append(case)
        print(f"{case['case_id']}: 工具名={case['tool_name_correct']} 参数={case['parameters_correct']}"
              f" 回复规则={case['faithful_by_rules']} ETA疑似={bool(case['suspected_eta_claims'])}", flush=True)

    summary = summarize(results)
    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "backend": {"mlx": version("mlx"), "mlx-lm": version("mlx-lm"), "device": mx.device_info()["device_name"]},
        "model": str(args.model), "model_sha256": identity, "adapter": adapter_info,
        "acceptance_sha256": sha256_file(ROOT / "acceptance.json"), "generation": SETTINGS,
        "summary": summary, "results": results,
    }
    if args.compare:
        reference = json.loads(args.compare.read_text(encoding="utf-8"))
        for key in ("backend", "model_sha256", "acceptance_sha256", "generation"):
            require(report[key] == reference[key], f"原模型报告与本次运行的 {key} 不一致")
        report["comparison"] = {"reference": str(args.compare), "delta": {
            key: count - reference["summary"][key] for key, count in summary.items()
        }}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compare", type=Path, help="同一底座的原模型报告")
    main(parser.parse_args())
