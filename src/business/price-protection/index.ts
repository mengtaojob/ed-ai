interface PriceProtectionExample {
  readonly orderId: string;
  readonly currentPriceFen: number;
  readonly eligibility: 'eligible' | 'ineligible';
  readonly estimatedDifferenceFen: number;
  readonly reason: string;
}

const priceProtectionExamples: readonly PriceProtectionExample[] = [
  {
    orderId: 'DEMO-1001',
    currentPriceFen: 89900,
    eligibility: 'eligible',
    estimatedDifferenceFen: 10000,
    reason: '示例中订单仍在保价期内，同渠道同款打印机降价 100 元。',
  },
  {
    orderId: 'DEMO-1002',
    currentPriceFen: 15900,
    eligibility: 'ineligible',
    estimatedDifferenceFen: 0,
    reason: '同渠道同款墨盒售价与订单实付价一致。',
  },
];

/** 按订单号 `orderId` 查询模拟保价资格、当前售价和预估差额。 */
export function findPriceProtectionExample(orderId: string): PriceProtectionExample | undefined {
  return priceProtectionExamples.find((example) => example.orderId === orderId);
}
