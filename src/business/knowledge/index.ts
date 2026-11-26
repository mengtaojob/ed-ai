interface KnowledgeArticle {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly content: string;
}

const articles: readonly KnowledgeArticle[] = [
  {
    id: 'PRINTER-A',
    title: '打印机 A 产品资料',
    source: 'Demo 产品手册 · 耗材规格',
    content: '打印机 A（型号 PRINTER-A）使用墨盒 B（型号 INK-B）。',
  },
  {
    id: 'PRINTER-A-E03',
    title: '打印机 A 报 E03 怎么办？',
    source: 'Demo 产品手册 · 常见故障',
    content: '关闭打印机电源，检查进纸口和出纸口是否卡纸。取出卡纸后重启打印机。如果仍显示 E03，请联系人工客服。',
  },
  {
    id: 'RETURN-POLICY',
    title: '退货退款政策',
    source: 'Demo 售后政策 · 退货退款',
    content: '商品签收后 7 天内，商品和配件齐全且符合退货条件时，可以申请退货退款。运输中的商品需要先确认配送状态。',
  },
  {
    id: 'PRICE-PROTECTION-POLICY',
    title: '保价政策',
    source: 'Demo 售后政策 · 保价',
    content: '在保价期内，同一渠道同一商品的当前售价低于实付价时，可以申请退还差额。',
  },
];

/** 按知识条目编号 `articleId` 查询条目正文及出处。 */
export function findKnowledgeArticle(articleId: string): KnowledgeArticle | undefined {
  return articles.find((article) => article.id === articleId);
}
