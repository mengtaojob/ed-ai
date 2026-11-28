# 本地知识原文入库

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

默认连接本机 Ollama 与 Qdrant，可用 `OLLAMA_EMBED_BASE_URL` 和 `QDRANT_URL` 指定本地服务地址。
