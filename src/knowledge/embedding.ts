import { z } from 'zod';

export const embeddingModel = 'qwen3-embedding:0.6b';
export const embeddingDimension = 1024;
const endpoint = new URL('/api/embed', process.env.OLLAMA_EMBED_BASE_URL
  || process.env.OLLAMA_OPENAI_BASE_URL || 'http://127.0.0.1:11434');
const embeddingResponse = z.object({
  embeddings: z.array(z.array(z.number()).length(embeddingDimension)),
});

/** 批量把原文或查询转成向量。检查每条向量的维度和数量，避免把错误模型的结果写进集合。 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const timeout = AbortSignal.timeout(45_000);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: embeddingModel, input: texts, truncate: false }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Ollama Embedding HTTP ${response.status}：${await response.text()}`);
  const { embeddings } = embeddingResponse.parse(await response.json());
  if (embeddings.length !== texts.length) throw new Error('Ollama 返回的向量数量与输入不一致');
  return embeddings;
}
