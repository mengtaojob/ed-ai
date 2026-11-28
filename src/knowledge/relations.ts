import { z } from 'zod';

export const relationSchema = z.object({
  id: z.string(), articleId: z.string(), subject: z.string(), predicate: z.string(), object: z.string(),
});

// 每条边只写原文明示的关系，articleId 指向可作为回答证据的完整资料。
export const knowledgeRelations: readonly z.infer<typeof relationSchema>[] = [
  { id: 'printer-a-uses-ink-b', articleId: 'PRINTER-A',
    subject: '打印机 A（PRINTER-A）', predicate: '使用', object: '墨盒 B（INK-B）' },
  { id: 'printer-a-e03-check-jam', articleId: 'PRINTER-A-E03',
    subject: '打印机 A 的 E03 故障', predicate: '排查', object: '关机后检查进纸口和出纸口是否卡纸' },
  { id: 'printer-a-restart-after-jam', articleId: 'PRINTER-A-E03',
    subject: '打印机 A 卡纸', predicate: '处理', object: '取出卡纸后重启打印机' },
  { id: 'printer-a-persistent-e03-handoff', articleId: 'PRINTER-A-E03',
    subject: '打印机 A 重启后仍显示 E03', predicate: '联系', object: '人工客服' },
  { id: 'return-policy-eligibility', articleId: 'RETURN-POLICY',
    subject: '退货退款', predicate: '申请条件', object: '签收后 7 天内且商品和配件齐全、符合退货条件' },
  { id: 'price-protection-eligibility', articleId: 'PRICE-PROTECTION-POLICY',
    subject: '保价退差额', predicate: '申请条件', object: '处于保价期且同一渠道同一商品的当前售价低于实付价' },
];
