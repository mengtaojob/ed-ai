interface Order {
  readonly id: string;
  readonly status: '待发货' | '运输中' | '已签收';
  readonly sku: string;
  readonly productName: string;
  readonly quantity: number;
  readonly paidAmountFen: number;
  readonly placedAt: string;
  readonly deliveredAt?: string;
}

const orders: readonly Order[] = [
  {
    id: 'DEMO-1001',
    status: '已签收',
    sku: 'PRINTER-A',
    productName: '打印机 A',
    quantity: 1,
    paidAmountFen: 99900,
    placedAt: '2026-11-18T10:00:00+08:00',
    deliveredAt: '2026-11-21T14:30:00+08:00',
  },
  {
    id: 'DEMO-1002',
    status: '运输中',
    sku: 'INK-B',
    productName: '墨盒 B',
    quantity: 1,
    paidAmountFen: 15900,
    placedAt: '2026-11-20T16:45:00+08:00',
  },
  {
    id: 'DEMO-1003',
    status: '待发货',
    sku: 'PRINTER-A',
    productName: '打印机 A',
    quantity: 1,
    paidAmountFen: 89900,
    placedAt: '2026-11-25T08:15:00+08:00',
  },
];

export function findOrder(orderId: string): Order | undefined {
  return orders.find((order) => order.id === orderId);
}
