interface TrackingEvent {
  readonly occurredAt: string;
  readonly description: string;
}

interface Shipment {
  readonly orderId: string;
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly status: '运输中' | '已签收';
  readonly events: readonly TrackingEvent[];
}

const shipments: readonly Shipment[] = [
  {
    orderId: 'DEMO-1001',
    trackingNumber: 'TRACK-DEMO-1001',
    carrier: '示例快递',
    status: '已签收',
    events: [
      { occurredAt: '2026-11-19T09:20:00+08:00', description: '快递已揽收' },
      { occurredAt: '2026-11-21T14:30:00+08:00', description: '包裹已签收' },
    ],
  },
  {
    orderId: 'DEMO-1002',
    trackingNumber: 'TRACK-DEMO-1002',
    carrier: '示例快递',
    status: '运输中',
    events: [
      { occurredAt: '2026-11-21T11:00:00+08:00', description: '快递已揽收' },
      { occurredAt: '2026-11-24T18:15:00+08:00', description: '包裹到达配送站，等待派送' },
    ],
  },
];

export function findShipmentByOrderId(orderId: string): Shipment | undefined {
  return shipments.find((shipment) => shipment.orderId === orderId);
}
