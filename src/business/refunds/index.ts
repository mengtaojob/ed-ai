interface RefundExample {
  readonly orderId: string;
  readonly eligibility: 'eligible' | 'ineligible';
  readonly estimatedRefundFen: number;
  readonly reason: string;
}

const refundExamples: readonly RefundExample[] = [
  {
    orderId: 'DEMO-1001',
    eligibility: 'eligible',
    estimatedRefundFen: 99900,
    reason: '示例中商品及配件齐全，签收后仍在 7 天退货期限内。',
  },
  {
    orderId: 'DEMO-1002',
    eligibility: 'ineligible',
    estimatedRefundFen: 0,
    reason: '商品仍在运输中，需要先确认配送状态。',
  },
];

/** 按订单号 `orderId` 查询模拟退款资格、预估退款金额和原因。 */
export function findRefundExample(orderId: string): RefundExample | undefined {
  return refundExamples.find((example) => example.orderId === orderId);
}
