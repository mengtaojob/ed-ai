# 本地知识原文和图谱投影

在 Apple Silicon 上使用 Qdrant 1.20.2 原生 arm64 二进制。数据库监听本机 `127.0.0.1:6333`，数据保存在项目忽略目录 `.local-rag/qdrant/storage/`。[Qdrant v1.20.2 发布页](https://github.com/qdrant/qdrant/releases/tag/v1.20.2)

在项目根目录下载并启动：

```sh
mkdir -p .local-rag/qdrant
curl -fL https://github.com/qdrant/qdrant/releases/download/v1.20.2/qdrant-aarch64-apple-darwin.tar.gz -o .local-rag/qdrant/release.tar.gz
printf '%s  %s\n' 385b244e6283968b2be926358541b5bc19b9ada7ea9586e900684388bc912d5f .local-rag/qdrant/release.tar.gz | shasum -a 256 -c -
tar -xzf .local-rag/qdrant/release.tar.gz -C .local-rag/qdrant
sh model-services/qdrant/start.sh
```

启动本地 Ollama 后，另开终端安装模型和导入数据：

```sh
npm ci
ollama pull qwen3-embedding:0.6b
npm run knowledge:import
curl -fsS http://127.0.0.1:6333/collections/yd_knowledge_articles/points/count \
  -H 'Content-Type: application/json' -d '{"exact":true}'
```

实测 Ollama 返回 1024 维，集合使用 1024 维 Cosine。四条原文来自 Koa 共享的演示资料，每条是一个点，保留 ID、标题、正文和出处。重复导入按稳定 ID 覆盖，连续两次导入后 Qdrant API 的精确计数均为 4。[Embedding 模型](https://ollama.com/library/qwen3-embedding:0.6b) · [Mastra Qdrant 集成](https://mastra.ai/integrations/vectors/qdrant)

导入命令也写入独立的 `yd_knowledge_relations` 集合。六条关系指向已有资料 ID，使用同一维度和度量。重复导入后精确计数为 6。

```sh
curl -fsS http://127.0.0.1:6333/collections/yd_knowledge_relations/points/count \
  -H 'Content-Type: application/json' -d '{"exact":true}'
```

默认连接本机 Ollama 与 Qdrant，可用 `OLLAMA_EMBED_BASE_URL` 和 `QDRANT_URL` 指定本地服务地址。

## 启动本机重排

用 Python 3.12 准备单独的虚拟环境、固定 revision 的 ONNX INT8 模型和 tokenizer。准备脚本会验证 SHA-256。启动后以 `/health` 确认使用 CPU。

```sh
sh model-services/reranker/prepare.sh
.local-rag/reranker-venv/bin/python model-services/reranker/server.py
curl -fsS http://127.0.0.1:8012/health
```

运行时只读取本地文件。ONNX Runtime 的 `CPUExecutionProvider` 对每个「问句、原文」对输出一个 logit。可用 `RERANKER_URL` 指定其它本机地址。[BGE 多语言 Cross-Encoder](https://huggingface.co/BAAI/bge-reranker-v2-m3) · [固定 ONNX 权重](https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/tree/6f5ff65298512715a1e669753bc754d2bc8f367b)

## 调用客服 Agent

启动 Koa、LAYA、重排和 Studio 后，调用实际客服 Agent：

```sh
curl -fsS http://127.0.0.1:4111/api/agents/support-agent/generate \
  -H 'Content-Type: application/json' -d '{"messages":"打印机 A 报 E03 怎么办？"}'
```

原文链路实测调用了 `searchKnowledge`，返回首条 `PRINTER-A-E03`，回复列出关机、排查卡纸、重启和故障持续时联系人工客服，并附「Demo 产品手册 · 常见故障」。

工具调用结果的 `trace` 包含原文召回、图谱关系、按 ID 回查成功的原文、去重后的重排输入和分数。关系用于定位资料。Qwen 的工具消息只包含状态和最多 3 条完整原文。

## Neo4j 导入计划

1. 以 [关系清单](../../src/knowledge/relations.ts) 和 [原文目录](../../src/business/knowledge/index.ts) 为来源。为产品、耗材、故障、处理步骤、政策和资料定义稳定 ID。例如产品用 `PRINTER-A`，耗材用 `INK-B`，故障用 `PRINTER-A:E03`。
2. 给 `Entity(id)` 和 `Article(id)` 建唯一约束。用参数化 `UNWIND` 和 `MERGE` 导入节点及关系，关系用当前稳定关系 ID 去重，属性保存 `articleId`。用 `SOURCED_FROM` 连到对应资料。
3. 导入后校验六条关系都能回到四条原文，抽查打印机 A 的耗材和 E03 排查路径。当前问答直接读 Qdrant 的关系投影和原文集合。
