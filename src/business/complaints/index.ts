interface Complaint {
  readonly id: string;
  readonly orderId: string;
  readonly category: string;
  readonly description: string;
  readonly status: '待处理' | '处理中' | '已结案';
  readonly createdAt: string;
}

const complaints: readonly Complaint[] = [
  {
    id: 'CMP-DEMO-001',
    orderId: 'DEMO-1002',
    category: '配送延误',
    description: '包裹到站后尚未派送，用户请求核实预计送达时间。',
    status: '待处理',
    createdAt: '2026-11-25T09:05:00+08:00',
  },
];

export function findComplaint(complaintId: string): Complaint | undefined {
  return complaints.find((complaint) => complaint.id === complaintId);
}
