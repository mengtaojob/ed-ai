import { z } from 'zod';
import { embedTexts } from './embedding.ts';
import { relationSchema } from './relations.ts';
import { rerank, rerankerIdentity } from './rerank.ts';
import { articleCollection, knowledgePointId, knowledgeStore, qdrantUrl, relationCollection } from './store.ts';

export const articleSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  source: z.string(),
});

const hitScore = z.object({ id: z.string(), score: z.number() });
const relationHit = relationSchema.extend({ score: z.number() });
const traceSchema = z.object({
  articleHits: z.array(hitScore),
  relationHits: z.array(relationHit),
  hydratedArticleIds: z.array(z.string()),
  rerankInputIds: z.array(z.string()),
  ranked: z.array(hitScore),
  reranker: rerankerIdentity.nullable(),
});
export const searchResultSchema = z.object({
  status: z.enum(['ok', 'insufficient_evidence', 'unavailable']),
  evidence: z.array(articleSchema.extend({ score: z.number() })).max(3),
  trace: traceSchema.nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

// 召回与重排各有一层门槛。logit 下限根据本项目中文 Demo 调试，不能当作通用置信度。
const minCosine = 0.45;
const minRerankLogit = -1.5;
const maxRerankGap = 2;

/** 按关系指向的 articleIds 批量读取 Qdrant 原文点。关系描述只能用于召回。 */
async function fetchArticles(articleIds: string[], signal?: AbortSignal) {
  if (!articleIds.length) return [];
  const ids = articleIds.map((id) => knowledgePointId(articleCollection, id));
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(new URL(`/collections/${articleCollection}/points`, qdrantUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, with_payload: true, with_vector: false }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Qdrant 原文回查 HTTP ${response.status}`);
  const { result } = z.object({ result: z.array(z.object({ id: z.string(), payload: articleSchema })) })
    .parse(await response.json());
  const resolved = new Map(result.map(({ id, payload }) => [id, payload]));
  return articleIds.flatMap((id, index) => {
    const article = resolved.get(ids[index]);
    return article?.id === id ? [article] : [];
  });
}

/** 一次向量化后并行搜原文与关系。回查原文、按资料 ID 去重，再用问题和原文对做重排。 */
export async function searchKnowledge(query: string, signal?: AbortSignal): Promise<SearchResult> {
  const [queryVector] = await embedTexts([
    `Instruct: Given a Chinese customer support question, retrieve passages that answer the question\nQuery: ${query}`,
  ], signal);
  const [docs, graph] = await Promise.all([articleCollection, relationCollection].map((indexName) => (
    knowledgeStore.query({ indexName, queryVector, topK: 6 })
  )));
  signal?.throwIfAborted();
  const articleHits = docs.filter(({ score }) => score >= minCosine).map(({ metadata, score }) => ({
    ...articleSchema.parse(metadata),
    score,
  }));
  const relationHits = graph.filter(({ score }) => score >= minCosine).map(({ metadata, score }) => ({
    ...relationSchema.parse(metadata),
    score,
  }));
  const hydrated = await fetchArticles([...new Set(relationHits.map(({ articleId }) => articleId))], signal);
  const candidates = [...new Map([
    ...articleHits.map(({ score: _score, ...article }) => [article.id, article] as const),
    ...hydrated.map((article) => [article.id, article] as const),
  ]).values()];

  const trace: z.infer<typeof traceSchema> = {
    articleHits: articleHits.map(({ id, score }) => ({ id, score })),
    relationHits,
    hydratedArticleIds: hydrated.map(({ id }) => id),
    rerankInputIds: candidates.map(({ id }) => id),
    ranked: [],
    reranker: null,
  };
  if (!candidates.length) return { status: 'insufficient_evidence', evidence: [], trace };

  const { scores, ...identity } = await rerank(query, candidates.map(({ title, content }) => `${title}\n${content}`), signal);
  const ranked = candidates.map((article, index) => ({ ...article, score: scores[index] }))
    .sort((left, right) => right.score - left.score);
  trace.reranker = identity;
  trace.ranked = ranked.map(({ id, score }) => ({ id, score }));
  // 同时按首位分数收窄证据，避免相邻主题（例如退款与保价）被一并展开。
  const cutoff = Math.max(minRerankLogit, ranked[0].score - maxRerankGap);
  const evidence = ranked.filter(({ score }) => score >= cutoff).slice(0, 3);
  return { status: evidence.length ? 'ok' : 'insufficient_evidence', evidence, trace };
}
