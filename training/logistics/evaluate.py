"""用固定的物流工具结果回放验收场景，记录原模型或适配器的实际输出。"""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from validate import ORDER_ID, ROOT, parse_example, read_split, validate_all

GENERATION = {"temperature": 0, "top_p": 1, "max_tokens": 256, "stream": False}
STATUS_PATTERNS = {
    "delivered": r"已(?:经|于[^，。！？]{1,32})?(?:被)?签收|签收成功",
    "in_transit": r"运输中|正在运输|派送|转运|揽收",
    "no_shipment": r"(?:暂无|尚无|尚未有|还没有|未查到|没有|无可查).{0,14}(?:物流|运单|轨迹)|物流.{0,6}(?:为空|暂缺)",
    "order_missing": r"(?:未找到|未查到|找不到|查不到|没有找到|没有查到|不存在).{0,12}订单|订单.{0,5}(?:不存在|未找到|查不到|未查到)",
    "unavailable": r"(?:服务|系统|查询|接口).{0,16}(?:不可用|无法|异常|故障|失败|稍后|重试|未能)|(?:暂时无法|暂时不能).{0,12}(?:查|使用|访问)|稍后(?:再|重)(?:试|查询)",
    "eta_unknown": r"(?:未|没有|暂无|尚无|无法|暂无法|不能|不确定).{0,16}(?:送达|到达|到货|收到|具体时间|预计时间)|(?:送达|到达|到货).{0,14}(?:未提供|未显示|无法确认|无法确定|还不确定|暂未)",
}
ARRIVAL = r"送达|到达|到货|收到|送到|派送"
TIME = r"今(?:天|晚|日)|明(?:天|晚|日)|后天|当日|次日|本周|下周|清晨|早上|上午|中午|下午|傍晚|晚上|午夜|周末|周[一二三四五六日天]|星期[一二三四五六日天]|\d+\s*(?:个?小时|分钟|天|月|号|日|点|:)|\d{4}-\d{1,2}-\d{1,2}"
ETA = re.compile(
    rf"(?:预计|估计|大概|最晚|约在)[^，。！？]{{0,14}}(?:{TIME})[^，。！？]{{0,14}}(?:{ARRIVAL})"
    rf"|(?:{TIME})[^，。！？]{{0,10}}(?:将|就会|会|即可|可以|能(?!(?:否|不能)))[^，。！？]{{0,6}}(?:{ARRIVAL})"
    rf"|(?:将在|会在|可以在|能在)[^，。！？]{{0,16}}(?:{TIME})[^，。！？]{{0,10}}(?:{ARRIVAL})"
)


def http_json(url, payload=None):
    """GET 查询本地模型版本，POST 提交一次 OpenAI 格式推理请求。"""
    body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = Request(url, data=body, headers={"content-type": "application/json"})
    try:
        with urlopen(request, timeout=180) as response:
            return json.load(response)
    except HTTPError as error:
        with error:
            detail = error.read(2048).decode(errors="replace")
        raise RuntimeError(f"HTTP {error.code} {url}: {detail}") from error


def model_reply(base_url, model, options, messages, tools):
    """统一模型请求。按原样保留回复和工具调用，方便人工复核误判。"""
    response = http_json(f"{base_url}/chat/completions", {
        "model": model, "messages": messages, "tools": tools, **options,
    })
    choice = response["choices"][0]
    message = choice["message"]
    return {
        "text": message.get("content") or "",
        "tool_calls": message.get("tool_calls") or [],
        "finish_reason": choice.get("finish_reason"),
    }


def replay_prefix(row, turns, call_index):
    """从 ShareGPT 取调用前的消息，追问场景使用冻结的参考追问，避免前一步错误影响后一步测量。"""
    messages = [{"role": "system", "content": row["system"]}]
    for turn in turns[:call_index]:
        messages.append({"role": "user" if turn["from"] == "human" else "assistant", "content": turn["value"]})
    return messages


def to_openai_tool_call(call):
    """把 ShareGPT 中的标准调用转成 OpenAI Chat 所需的工具调用消息。"""
    return {
        "id": "call_logistics",
        "type": "function",
        "function": {"name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False)},
    }


def check_call(response, expected):
    """分别记录工具名和参数。没有恰好一次调用时，两项都记为失败。"""
    calls = response["tool_calls"]
    if len(calls) != 1 or "function" not in calls[0]:
        return False, False
    function = calls[0]["function"]
    try:
        arguments = json.loads(function["arguments"])
    except (KeyError, ValueError, TypeError):
        arguments = None
    return function.get("name") == expected["name"], arguments == expected["arguments"]


def eta_claims(text):
    """找出疑似编造的具体送达承诺，忽略明确表示不确定的句子。"""
    claims = []
    for sentence in re.split(r"[。！？\n]", text):
        if re.search(r"无法确认|无法确定|不能保证|不能确认|不确定|无法判断|不能判断|不保证", sentence):
            continue
        claims.extend(match.group() for match in ETA.finditer(sentence))
    return claims


def score_reply(response, call, observation, metadata):
    """用可解释的规则作初筛，并保留原文以人工核对语义和时间。"""
    text = response["text"]
    category = metadata["category"]
    data = observation["data"] or {}
    expected_order = call["arguments"]["recordId"]
    all_orders = ORDER_ID.findall(re.sub(r"TRACK-DEMO-[0-9]+", "", text.upper()))
    tracking_numbers = re.findall(r"TRACK-DEMO-[0-9]+", text.upper())
    eta = eta_claims(text)
    notes = []
    if not re.search(STATUS_PATTERNS[category], text):
        notes.append("回复未明确表达该场景的状态")
    if category == "in_transit" and re.search(r"(?:已经|已)签收", text):
        notes.append("把运输中误报为已签收")
    if metadata["requires_tracking_number"] and data.get("trackingNumber") not in tracking_numbers:
        notes.append("缺少用户要求的运单号")
    if any(record != expected_order for record in all_orders):
        notes.append("回复出现了其他订单号")
    if any(tracking != data.get("trackingNumber") for tracking in tracking_numbers):
        notes.append("回复出现了工具没有给出的运单号")
    if re.search(r"已发货|运输中|已签收|等待派送", text) and observation["code"] != "OK":
        notes.append("查询失败时声称知道物流状态")
    if response["tool_calls"]:
        notes.append("收到工具结果后又请求调用工具")
    if eta:
        notes.append("出现疑似未经工具证实的预计送达时间")
    return not notes, eta, notes


def run_case(row, reply):
    """分开测追问、工具选择和答复。答复总是回放同一份正确工具输入和返回值。"""
    metadata = row["metadata"]
    turns, call_index, expected_call, observation = parse_example(row)
    messages = replay_prefix(row, turns, call_index)
    tools = [{"type": "function", "function": tool} for tool in json.loads(row["tools"])]
    clarification = None
    if call_index > 1:
        clarification = reply(messages[:2], tools)
        clarification["pass"] = bool(re.search(r"订单号|订单编号", clarification["text"])) and not clarification["tool_calls"]

    proposed_call = reply(messages, tools)
    tool_correct, args_correct = check_call(proposed_call, expected_call)
    gold_tool = to_openai_tool_call(expected_call)
    spoken = reply([
        *messages,
        {"role": "assistant", "content": "", "tool_calls": [gold_tool]},
        {"role": "tool", "tool_call_id": gold_tool["id"], "content": turns[call_index + 1]["value"]},
    ], tools)
    faithful, eta, notes = score_reply(spoken, expected_call, observation, metadata)
    return {
        "case_id": metadata["case_id"],
        "category": metadata["category"],
        "source": metadata["source"],
        "expected_call": expected_call,
        "clarification": clarification,
        "call": proposed_call,
        "tool_name_correct": tool_correct,
        "parameters_correct": args_correct,
        "replay_reply": spoken,
        "faithful_by_rules": faithful,
        "suspected_eta_claims": eta,
        "review_notes": notes,
    }


def summarize(results):
    """计数时保留分母，ETA 仅记录规则发现的疑似承诺。"""
    clarified = [case["clarification"] for case in results if case["clarification"] is not None]
    return {
        "cases": len(results),
        "clarification_cases": len(clarified),
        "clarification_pass": sum(record["pass"] for record in clarified),
        "tool_name_pass": sum(case["tool_name_correct"] for case in results),
        "parameters_pass": sum(case["parameters_correct"] for case in results),
        "tool_call_pass": sum(case["tool_name_correct"] and case["parameters_correct"] for case in results),
        "faithful_by_rules": sum(case["faithful_by_rules"] for case in results),
        "cases_with_suspected_eta": sum(bool(case["suspected_eta_claims"]) for case in results),
    }


def main(args):
    validate_all()
    base = args.base_url.rstrip("/")
    settings = dict(GENERATION)
    identity = {}
    if args.backend == "ollama":
        settings.update(seed=42, reasoning_effort="none")
        root = base.removesuffix("/v1")
        identity["ollama_version"] = http_json(root + "/api/version")["version"]
        models = http_json(root + "/api/tags")["models"]
        identity["installed_model"] = next(item for item in models if item["name"] == args.model)
    else:
        settings["do_sample"] = False

    def reply(messages, tools):
        return model_reply(base, args.model, settings, messages, tools)

    results = []
    for row in read_split("acceptance"):
        outcome = run_case(row, reply)
        results.append(outcome)
        print(f"{outcome['case_id']}: 工具名={outcome['tool_name_correct']} 参数={outcome['parameters_correct']}"
              f" 回复规则={outcome['faithful_by_rules']} ETA疑似={bool(outcome['suspected_eta_claims'])}", flush=True)

    summary = summarize(results)
    run = {
        "run_label": args.label, "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "backend": args.backend, "base_url": base, "model": args.model, "model_identity": identity,
        "acceptance_sha256": sha256((ROOT / "acceptance.json").read_bytes()).hexdigest(),
        "generation": settings, "summary": summary, "results": results,
    }
    if args.compare:
        reference = json.loads(args.compare.read_text(encoding="utf-8"))
        comparable = all(run[key] == reference[key] for key in ("backend", "acceptance_sha256", "generation"))
        run["comparison"] = {
            "reference": str(args.compare), "matching_test_settings": comparable,
            "delta": {key: count - reference["summary"][key] for key, count in summary.items()},
        }
        if not comparable:
            print("对比使用了不同后端、设置或验收数据，分数差异不能单独归因于适配器。")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(run, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=("ollama", "llamafactory"), default="ollama")
    parser.add_argument("--base-url", default="http://127.0.0.1:11434/v1")
    parser.add_argument("--model", default="qwen3.5:4b")
    parser.add_argument("--label", default="base-ollama")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compare", type=Path, help="另一轮验收报告，输出各指标差值")
    args = parser.parse_args()
    try:
        main(args)
    except (OSError, ValueError, RuntimeError, StopIteration) as error:
        parser.exit(1, f"评估失败：{error}\n")
