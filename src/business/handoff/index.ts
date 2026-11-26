interface ConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface Handoff {
  readonly id: string;
  readonly conversationId: string;
  readonly orderId: string;
  readonly complaintId: string;
  readonly reason: string;
  readonly status: '待接管' | '已接管';
  readonly messages: readonly ConversationMessage[];
}

const handoffs: readonly Handoff[] = [
  {
    id: 'HOF-DEMO-001',
    conversationId: 'CHAT-DEMO-001',
    orderId: 'DEMO-1002',
    complaintId: 'CMP-DEMO-001',
    reason: '用户明确要求人工客服核实投诉进度。',
    status: '待接管',
    messages: [
      { role: 'user', content: '我的配送投诉 CMP-DEMO-001 有进展吗？' },
      { role: 'assistant', content: '投诉目前待处理，关联订单为 DEMO-1002。' },
      { role: 'user', content: '请转人工客服帮我催一下。' },
    ],
  },
];

/** 按转人工记录编号 `handoffId` 查询模拟接管状态及会话内容。 */
export function findHandoff(handoffId: string): Handoff | undefined {
  return handoffs.find((handoff) => handoff.id === handoffId);
}
