"""用本地 ONNX Cross-Encoder 对问题和候选原文成对打分。"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL = "BAAI/bge-reranker-v2-m3 ONNX INT8"


def serve(model_dir, port):
    """model_dir 保存权重和 tokenizer。模型启动时加载一次，HTTP 只监听回环地址。"""
    tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
    tokenizer.enable_padding(pad_id=tokenizer.token_to_id("<pad>"), pad_token="<pad>")
    tokenizer.enable_truncation(max_length=512)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(model_dir / "model_int8.onnx"), options,
                                   providers=["CPUExecutionProvider"])
    identity = {"model": MODEL, "provider": session.get_providers()[0], "onnxruntime": ort.__version__}

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.send_json(200, identity)
            else:
                self.send_json(404, {"error": "接口不存在"})

        def do_POST(self):
            if self.path != "/rerank":
                self.send_json(404, {"error": "接口不存在"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 131_072:
                    raise ValueError("请求长度无效")
                payload = json.loads(self.rfile.read(length))
                query, passages = payload["query"], payload["passages"]
                if not isinstance(query, str) or not query.strip() or not isinstance(passages, list):
                    raise ValueError("需要问题和候选原文列表")
                if not 1 <= len(passages) <= 16 or not all(isinstance(text, str) and text.strip() for text in passages):
                    raise ValueError("需要 1 至 16 条非空候选原文")
            except (ValueError, TypeError, KeyError, UnicodeDecodeError) as error:
                self.send_json(400, {"error": str(error)})
                return

            # 每对输入把问题与原文放在同一个序列，logit 按 passages 原顺序返回。
            encoded = tokenizer.encode_batch([(query, passage) for passage in passages])
            inputs = {
                "input_ids": np.array([row.ids for row in encoded], dtype=np.int64),
                "attention_mask": np.array([row.attention_mask for row in encoded], dtype=np.int64),
            }
            scores = session.run(["logits"], inputs)[0][:, 0]
            self.send_json(200, {**identity, "scores": scores.tolist()})

    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        print(f"{MODEL} 已启动，使用 {identity['provider']}，http://127.0.0.1:{port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(".local-rag/reranker"))
    parser.add_argument("--port", type=int, default=8012)
    args = parser.parse_args()
    serve(args.model_dir, args.port)
