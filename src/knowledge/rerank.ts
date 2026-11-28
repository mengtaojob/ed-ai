import { z } from 'zod';

const endpoint = new URL('/rerank', process.env.RERANKER_URL || 'http://127.0.0.1:8012');
export const rerankerIdentity = z.object({
  model: z.string(),
  provider: z.literal('CPUExecutionProvider'),
  onnxruntime: z.string(),
});
const responseSchema = rerankerIdentity.extend({ scores: z.array(z.number()) });

/** 把同一问题和每条候选原文组成一对，取得与 passages 顺序一致的 ONNX 原始分数。 */
export async function rerank(query: string, passages: string[], signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, passages }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`ONNX Reranker HTTP ${response.status}`);
  const result = responseSchema.parse(await response.json());
  if (result.scores.length !== passages.length) throw new Error('Reranker 返回的分数数量与候选不一致');
  return result;
}
