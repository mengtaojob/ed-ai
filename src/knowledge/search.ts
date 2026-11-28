import { z } from 'zod';
import { embedTexts } from './embedding.ts';
import { articleCollection, knowledgeStore } from './store.ts';

export const articleSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  source: z.string(),
});

/** 搜索 Qdrant 中的短原文。问题带检索指令，入库向量保留标题和原文。 */
export async function searchKnowledge(query: string, signal?: AbortSignal) {
  const [queryVector] = await embedTexts([
    `Instruct: Given a Chinese customer support question, retrieve passages that answer the question\nQuery: ${query}`,
  ], signal);
  const hits = await knowledgeStore.query({ indexName: articleCollection, queryVector, topK: 3 });
  return hits.filter(({ score }) => score >= 0.45).map(({ metadata, score }) => ({
    ...articleSchema.parse(metadata),
    score,
  }));
}
