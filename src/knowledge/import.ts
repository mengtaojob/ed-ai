import { knowledgeArticles } from '../business/knowledge/index.ts';
import { embeddingModel } from './embedding.ts';
import { articleCollection, upsertKnowledge } from './store.ts';

// 一条短原文对应一个点。标题和正文用于检索，入库时同时保存资料 ID、正文及出处。
const entries = knowledgeArticles.map((article) => ({
  id: article.id,
  text: `${article.title}\n${article.content}`,
  payload: { ...article },
}));
const stats = await upsertKnowledge(articleCollection, entries);
console.log(JSON.stringify({ model: embeddingModel, collection: articleCollection, ...stats }, null, 2));
