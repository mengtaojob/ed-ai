"""检查 ShareGPT 数据、工具契约和训练/验证/验收之间的隔离。"""

import argparse
import json
import re
from datetime import datetime
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
SPLITS = ("train", "validation", "acceptance")
ORDER_ID = re.compile(r"DEMO-[0-9]+")
TOOL_NAME = "lookup_logistics"
ERRORS = {
    "no_shipment": ("SHIPMENT_NOT_FOUND", "该订单暂无物流记录"),
    "order_missing": ("ORDER_NOT_FOUND", "未找到该订单"),
    "unavailable": ("BUSINESS_UNAVAILABLE", "业务查询暂不可用，请稍后再试。"),
}
SUCCESS_STATES = {"delivered": "已签收", "in_transit": "运输中", "eta_unknown": "运输中"}


def require(condition, message):
    """发现数据错误就报明原因，避免把坏样本送去训练。"""
    if not condition:
        raise ValueError(message)


def read_split(split):
    return json.loads((ROOT / f"{split}.json").read_text(encoding="utf-8"))


def parse_example(row):
    """按 ShareGPT 角色顺序取出对话、工具调用和观测结果，供校验和回放复用。"""
    turns = row["conversations"]
    roles = [turn["from"] for turn in turns]
    for turn in turns:
        require(isinstance(turn["value"], str) and turn["value"].strip(), "对话内容必须是非空字符串")
    call_index = len(turns) - 3
    full_turn = ["human", "function_call", "observation", "gpt"]
    require(roles in (full_turn, ["human", "gpt", *full_turn]), f"消息或工具配对顺序有误：{roles}")
    return turns, call_index, json.loads(turns[call_index]["value"]), json.loads(turns[call_index + 1]["value"])


def validate_response(observation, record_id, category):
    """核对工具必须返回的字段和分类，区分三种查询失败。"""
    require(set(observation) == {"code", "message", "data"}, "工具返回必须有 code、message、data 三个字段")
    if category in ERRORS:
        code, message = ERRORS[category]
        require(observation == {"code": code, "message": message, "data": None}, f"{category} 的业务状态不正确")
        return

    data = observation["data"]
    require(observation["code"] == "OK" and observation["message"] == "成功", "成功查询必须返回 OK")
    require(isinstance(data, dict) and set(data) == {
        "orderId", "trackingNumber", "carrier", "status", "events",
    }, "成功响应的物流字段和现有 Mock 契约不符")
    require(data["orderId"] == record_id and data["status"] == SUCCESS_STATES[category], "物流订单号或状态与样例不符")
    require(all(isinstance(data[key], str) and data[key].strip() for key in ("trackingNumber", "carrier")), "运单号或承运商为空")
    require(isinstance(data["events"], list) and data["events"], "成功结果缺少物流轨迹")
    times = []
    for event in data["events"]:
        require(set(event) == {"occurredAt", "description"} and event["description"].strip(), "轨迹事件字段有误")
        occurred = datetime.fromisoformat(event["occurredAt"])
        require(occurred.utcoffset() is not None, "物流时间缺少时区")
        times.append(occurred)
    require(times == sorted(times), "轨迹未按时间升序排列")


def validate_example(row, split):
    """检查参数来源。需要追问时，编号只能出现在后续用户消息。"""
    meta = row["metadata"]
    require(all(isinstance(meta[key], str) and meta[key].strip() for key in ("case_id", "template")), "样例或模板缺少编号")
    require(meta["category"] in ERRORS.keys() | SUCCESS_STATES.keys(), "未知物流场景")
    require(type(meta["requires_tracking_number"]) is bool, "必须声明是否要求回复运单号")
    allowed_sources = {"synthetic", "mock_http", "tool_fallback"} if split == "acceptance" else {"synthetic"}
    require(meta["source"] in allowed_sources, "来源标签不符合数据集分工")
    require(isinstance(row["system"], str) and row["system"].strip(), "缺少系统提示词")
    require(not ORDER_ID.search(row["system"]) and not ORDER_ID.search(row["tools"]), "共用提示词和工具说明不能写入样例订单号")
    tools = json.loads(row["tools"])
    require(len(tools) == 1 and tools[0]["name"] == TOOL_NAME, "只允许 lookup_logistics 工具")
    schema = tools[0]["parameters"]
    require(schema["type"] == "object" and schema["required"] == ["recordId"]
            and set(schema["properties"]) == {"recordId"}
            and schema["properties"]["recordId"]["pattern"] == r"^DEMO-\d+$", "工具参数定义有误")
    turns, call_index, call, observation = parse_example(row)
    require(set(call) == {"name", "arguments"} and call["name"] == TOOL_NAME, "工具名或调用字段无效")
    require(set(call["arguments"]) == {"recordId"}, "工具只接收 recordId")
    record_id = call["arguments"]["recordId"]
    require(isinstance(record_id, str) and ORDER_ID.fullmatch(record_id), "recordId 必须符合 DEMO-数字")
    user_turns = [turn["value"] for turn in turns if turn["from"] == "human"]
    require(ORDER_ID.findall(user_turns[-1]) == [record_id], "工具参数必须等于用户最后提供的订单号")
    if call_index == 3:
        require(not ORDER_ID.search(user_turns[0]) and "订单号" in turns[1]["value"], "缺号样例必须先追问订单号")
    validate_response(observation, record_id, meta["category"])
    if meta["source"] == "tool_fallback":
        require(observation["code"] == "BUSINESS_UNAVAILABLE", "工具降级样例必须保留服务不可用的返回")
    if meta["requires_tracking_number"]:
        require(observation["code"] == "OK" and observation["data"]["trackingNumber"] in turns[-1]["value"],
                "要求回复运单号的示范必须使用工具给出的运单")

    # 把编号、空格和标点抹掉，避免只换一个订单号就跨集合复用原句。
    signature = "|".join(re.sub(r"[\W_]+", "", ORDER_ID.sub("ORDERID", text.upper())) for text in user_turns)
    return record_id, signature, observation


def fetch_mock(base_url, record_id):
    """可选地将冻结的响应与正在运行的 Koa HTTP 接口逐字段比对。"""
    try:
        with urlopen(f"{base_url.rstrip('/')}/api/v1/orders/{record_id}/logistics", timeout=5) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code != 404:
            raise
        with error:
            return json.load(error)


def validate_all(mock_url=None):
    """逐行检查三个集合，再比较订单号、模板标签和用户提问指纹。"""
    registered = json.loads((ROOT / "dataset_info.json").read_text(encoding="utf-8"))
    require(set(registered) == {"logistics_train", "logistics_validation"}, "LLaMA-Factory 只应注册训练和验证集")
    for split in SPLITS[:2]:
        entry = registered[f"logistics_{split}"]
        require(entry["file_name"] == f"{split}.json" and entry["formatting"] == "sharegpt", f"{split} 的注册配置不符")
        require(entry["columns"] == {"messages": "conversations", "system": "system", "tools": "tools"}, "ShareGPT 列映射不符")

    sets = {}
    live = {}
    seen_cases = set()
    shared_prompt = None
    shared_tools = None
    for split in SPLITS:
        rows = read_split(split)
        orders, templates, signatures, coverage = set(), set(), set(), set()
        for row in rows:
            meta = row["metadata"]
            case_id = meta["case_id"]
            try:
                record, signature, observation = validate_example(row, split)
                require(case_id not in seen_cases and signature not in signatures, "重复样例编号或重复提问")
                shared_prompt = shared_prompt or row["system"]
                shared_tools = shared_tools or row["tools"]
                require(row["system"] == shared_prompt and row["tools"] == shared_tools, "三个集合应使用同一提示词和工具契约")
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                raise ValueError(f"{split}/{case_id}: {error}") from error
            seen_cases.add(case_id)
            orders.add(record)
            templates.add(meta["template"])
            signatures.add(signature)
            coverage.add(meta["category"])
            if mock_url and meta["source"] == "mock_http":
                if record not in live:
                    live[record] = fetch_mock(mock_url, record)
                require(live[record] == observation, f"{case_id} 的冻结响应与实时 Koa 响应不一致")

        require(coverage == ERRORS.keys() | SUCCESS_STATES.keys(), f"{split} 缺少必要场景")
        clarify = sum(len(row["conversations"]) == 6 for row in rows)
        require(clarify > 0, f"{split} 缺少追问示范")
        sets[split] = (orders, templates, signatures)
        print(f"{split}: {len(rows)} 条，覆盖 {len(coverage)} 类，含 {clarify} 条追问")

    for left, right in combinations(SPLITS, 2):
        for key, left_values, right_values in zip(("订单号", "模板", "提问指纹"), sets[left], sets[right]):
            require(not left_values & right_values, f"{left}/{right} 有重复{key}：{left_values & right_values}")
        for first in sets[left][2]:
            for second in sets[right][2]:
                if min(len(first), len(second)) >= 14 and first.count("|") == second.count("|"):
                    require(SequenceMatcher(None, first, second, autojunk=False).ratio() < 0.90,
                            f"{left}/{right} 提问模板近似重复：{first} / {second}")
    if mock_url:
        print(f"Koa HTTP 回放核对通过：{len(live)} 个不同订单号")
    print("通过：工具契约、调用配对、场景覆盖和三个集合的隔离")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mock-url", help="可选的 Koa 基址，逐字段复核冻结的线上 Mock 数据")
    args = parser.parse_args()
    try:
        validate_all(args.mock_url)
    except (OSError, ValueError) as error:
        parser.exit(1, f"校验失败：{error}\n")
