import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchResult } from '../knowledge/search.ts';
import { insufficientKnowledge, validateKnowledgeCitations } from './knowledge-citations.ts';

const result: SearchResult = {
  status: 'ok',
  evidence: [{ id: 'PRINTER-A', title: '打印机 A 产品资料', content: '打印机 A 使用墨盒 B。',
    source: 'Demo 产品手册 · 耗材规格', score: 5 }],
  trace: null,
};

test('用本轮原文重建出处并去重', () => {
  assert.equal(validateKnowledgeCitations('打印机 A 使用墨盒 B。\n\n出处：[PRINTER-A] 随意名称 [PRINTER-A]', result),
    '打印机 A 使用墨盒 B。\n\n出处：[PRINTER-A] Demo 产品手册 · 耗材规格');
  assert.equal(validateKnowledgeCitations('打印机 A 使用墨盒 B。\n\n**出处**：PRINTER-A', result),
    '打印机 A 使用墨盒 B。\n\n出处：[PRINTER-A] Demo 产品手册 · 耗材规格');
});

test('拒绝用历史资料或不存在的资料为本轮作答', () => {
  for (const draft of ['墨盒 B。', '墨盒 B。\n出处：[RETURN-POLICY]',
    '墨盒 B。\n出处：[PRINTER-A] [FAKE-ID]', '墨盒 B。[FAKE-ID]\n出处：[PRINTER-A]']) {
    assert.equal(validateKnowledgeCitations(draft, result), insufficientKnowledge);
  }
});

test('本轮证据为空时，丢弃模型给出的推测和出处', () => {
  assert.equal(validateKnowledgeCitations('打印机 A 支持 5GHz。\n出处：[PRINTER-A]', {
    status: 'insufficient_evidence', evidence: [], trace: null,
  }), insufficientKnowledge);
});
