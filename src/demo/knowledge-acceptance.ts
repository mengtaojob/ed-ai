import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { searchResultSchema } from '../knowledge/search.ts';

const endpoint = new URL('/api/agents/support-agent/generate', process.env.MASTRA_URL || 'http://127.0.0.1:4111');
const outputDir = '.local-rag/acceptance';
const responseSchema = z.object({
  text: z.string(),
  runId: z.string(),
  toolCalls: z.array(z.object({ payload: z.object({ toolName: z.string(), args: z.unknown() }) })),
  toolResults: z.array(z.object({ payload: z.object({ toolName: z.string(), result: z.unknown() }) })),
  steps: z.array(z.object({ request: z.object({ body: z.unknown() }) })),
});

// 必答问题用真实客服 API，带订单号的几项同时检验知识分支没有截走原业务查询。
const knowledgeCases = [
  { id: 'e03', question: '打印机 A 报 E03 怎么办？', article: 'PRINTER-A-E03',
    relation: 'printer-a-e03-check-jam', expected: /关[闭机].*卡纸.*重启/s },
  { id: 'ink', question: '打印机 A 该买哪款墨盒？', article: 'PRINTER-A',
    relation: 'printer-a-uses-ink-b', expected: /墨盒\s*B/ },
  { id: 'refund-policy', question: '请问你们的通用退货退款政策是什么？', article: 'RETURN-POLICY',
    relation: 'return-policy-eligibility', expected: /签收.{0,8}7\s*天/ },
  { id: 'price-policy', question: '请问通用保价规则是什么？', article: 'PRICE-PROTECTION-POLICY',
    relation: 'price-protection-eligibility', expected: /保价期.*低于.*差额/s },
  { id: 'missing', question: '打印机 A 支持连接 5GHz Wi-Fi 吗？', article: null,
    relation: null, expected: /^现有资料不足以确认这个问题。$/ },
  { id: 'reordered', question: '打印机 A 之前报 E03，修好后我该买哪款墨盒？', article: 'PRINTER-A',
    relation: 'printer-a-uses-ink-b', expected: /墨盒\s*B/ },
];
const businessCases = [
  { id: 'logistics', question: '帮我查 DEMO-1002 的物流', tool: 'lookup_logistics',
    recordId: 'DEMO-1002', expected: /配送站.*等待派送/s },
  { id: 'refund-order', question: '请查 DEMO-1001 的退款资格', tool: 'lookup_refund',
    recordId: 'DEMO-1001', expected: /999/ },
  { id: 'price-order', question: '帮我查订单 DEMO-1001 是否符合保价资格', tool: 'lookup_price_protection',
    recordId: 'DEMO-1001', expected: /100/ },
];

/** 调用 Studio 所在服务的 generate 接口，保留每轮完整返回供回查证据。 */
async function runCase(id: string, question: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: question }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`${id}: Mastra HTTP ${response.status} ${await response.text()}`);
  const raw: unknown = await response.json();
  await writeFile(join(outputDir, `rag-${id}.json`), JSON.stringify(raw, null, 2) + '\n');
  return responseSchema.parse(raw);
}

await mkdir(outputDir, { recursive: true });
const summary = [];
for (const item of knowledgeCases) {
  const answer = await runCase(item.id, item.question);
  assert.deepEqual(answer.toolCalls.map(({ payload }) => payload.toolName), ['searchKnowledge'], item.id);
  const data = searchResultSchema.parse(answer.toolResults[0]?.payload.result);
  const { trace, evidence } = data;
  assert(trace && trace.reranker?.provider === 'CPUExecutionProvider', `${item.id} 未执行 CPU 重排`);
  assert.equal(new Set(trace.rerankInputIds).size, trace.rerankInputIds.length, `${item.id} 候选未去重`);
  assert.equal(trace.ranked.length, trace.rerankInputIds.length, `${item.id} 候选未全部打分`);
  const ids = evidence.map(({ id }) => id);
  const citedIds = [...answer.text.matchAll(/\[([A-Z][A-Z0-9-]+)\]/g)].map(([, id]) => id);
  assert(citedIds.every((id) => ids.includes(id)), `${item.id} 引用了本轮证据以外的资料`);
  assert.match(answer.text, item.expected, item.id);
  if (item.article) {
    assert.equal(data.status, 'ok', item.id);
    assert.equal(ids[0], item.article, `${item.id} 原文首位不正确`);
    assert(citedIds.includes(item.article), `${item.id} 未引用目标资料`);
    assert(answer.text.includes(evidence[0].source), `${item.id} 缺少实际出处`);
    assert(trace.relationHits.some(({ id, articleId }) => id === item.relation && articleId === item.article), item.id);
    assert(trace.hydratedArticleIds.includes(item.article), `${item.id} 图谱命中后没有按 ID 回查到原文`);
  } else {
    assert.equal(data.status, 'insufficient_evidence', item.id);
    assert.deepEqual(ids, [], item.id);
    assert.deepEqual(citedIds, [], item.id);
  }
  if (item.id === 'reordered') assert.notEqual(trace.rerankInputIds[0], trace.ranked[0].id, '重排未改变首位');
  if (item.id === 'refund-policy') assert.deepEqual(ids, ['RETURN-POLICY'], '通用退款证据混入保价政策');

  // 查真正发给 Ollama 的最后一轮请求，诊断数据只留在 Tool 结果中。
  const body = answer.steps.at(-1)?.request.body;
  const { messages } = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) })
    .parse(typeof body === 'string' ? JSON.parse(body) : body);
  const toolMessage = messages.filter(({ role }) => role === 'tool').at(-1);
  assert(typeof toolMessage?.content === 'string', `${item.id} 模型没有读取工具结果`);
  const modelOutput = JSON.parse(toolMessage.content);
  assert(!('trace' in modelOutput), `${item.id} 不应向模型发送诊断内容`);
  assert.deepEqual(modelOutput.evidence.map(({ id }: { id: string }) => id), ids);
  summary.push({ ...item, expected: undefined, tool: 'searchKnowledge', runId: answer.runId, status: data.status,
    answer: answer.text, evidenceIds: ids, citedIds, trace });
  console.log(`${item.id}: searchKnowledge → ${ids.join(', ') || '证据不足'}`);
}
for (const item of businessCases) {
  const answer = await runCase(item.id, item.question);
  assert.deepEqual(answer.toolCalls.map(({ payload }) => payload), [
    { toolName: item.tool, args: { recordId: item.recordId } },
  ], item.id);
  assert.match(answer.text, item.expected, item.id);
  summary.push({ ...item, expected: undefined, runId: answer.runId, answer: answer.text });
  console.log(`${item.id}: ${item.tool} → ${item.recordId}`);
}
await writeFile(join(outputDir, 'rag-summary.json'), JSON.stringify(summary, null, 2) + '\n');
