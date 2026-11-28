import { createHash } from 'node:crypto';
import { QdrantVector } from '@mastra/qdrant';
import { embeddingDimension, embedTexts } from './embedding.ts';

export const articleCollection = 'yd_knowledge_articles';
export const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
export const knowledgeStore = new QdrantVector({
  id: 'local-knowledge-qdrant',
  url: qdrantUrl,
  checkCompatibility: false,
  timeout: 10_000,
});

/** 用集合名与业务 ID 派生 Qdrant 点 ID。资料更新或重导时覆盖同一个点。 */
export function knowledgePointId(collection: string, id: string): string {
  const hash = createHash('sha256').update(JSON.stringify([collection, id])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** 表中每项的 text 参与向量化，payload 保存原始字段，供检索后还原原文。 */
export async function upsertKnowledge(
  collection: string,
  entries: { id: string; text: string; payload: Record<string, unknown> }[],
) {
  const vectors = await embedTexts(entries.map(({ text }) => text));
  await knowledgeStore.createIndex({ indexName: collection, dimension: embeddingDimension, metric: 'cosine' });
  const config = await knowledgeStore.describeIndex({ indexName: collection });
  if (config.dimension !== embeddingDimension || config.metric !== 'cosine') {
    throw new Error(`${collection} 必须是 ${embeddingDimension} 维 Cosine 集合，当前为 ${config.dimension} 维 ${config.metric}`);
  }
  await knowledgeStore.upsert({
    indexName: collection,
    ids: entries.map(({ id }) => knowledgePointId(collection, id)),
    vectors,
    metadata: entries.map(({ payload }) => payload),
  });
  return knowledgeStore.describeIndex({ indexName: collection });
}
