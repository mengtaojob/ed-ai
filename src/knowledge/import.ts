import { knowledgeArticles } from '../business/knowledge/index.ts';
import { embeddingModel } from './embedding.ts';
import { knowledgeRelations } from './relations.ts';
import { articleCollection, relationCollection, upsertKnowledge } from './store.ts';

const articleIds = new Set(knowledgeArticles.map(({ id }) => id));
for (const relation of knowledgeRelations) {
  if (!articleIds.has(relation.articleId)) throw new Error(`图谱关系 ${relation.id} 缺少原文 ${relation.articleId}`);
}

// 一条短原文对应一个点。标题和正文用于检索，入库时同时保存资料 ID、正文及出处。
const entries = knowledgeArticles.map((article) => ({
  id: article.id,
  text: `${article.title}\n${article.content}`,
  payload: { ...article },
}));
const articleStats = await upsertKnowledge(articleCollection, entries);
const relationStats = await upsertKnowledge(relationCollection, knowledgeRelations.map((relation) => ({
  id: relation.id,
  text: `${relation.subject} ${relation.predicate} ${relation.object}`,
  payload: { ...relation },
})));
console.log(JSON.stringify({ model: embeddingModel, collections: {
  [articleCollection]: articleStats, [relationCollection]: relationStats,
} }, null, 2));
