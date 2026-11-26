const baseUrl = process.env.LAYA_BASE_URL || 'http://127.0.0.1:8000';
const endpoint = new URL('/v1/systemone', baseUrl);

const intents = {
  knowledge: {
    label: '知识问答',
    description: '产品知识、打印机故障、E03、卡纸、售后政策',
    example: '打印机报 E03，怎么排查卡纸？',
  },
  order: {
    label: '查订单',
    description: '查询订单详情、购买商品、付款金额或订单状态。',
    example: '帮我查一下 DEMO-1001 买了什么、实付多少钱。',
  },
  logistics: {
    label: '查物流',
    description: '快递物流、运单、配送、派送进度',
    example: '我的包裹现在到哪个配送站了，什么时候能送到？',
  },
  refund: {
    label: '退款',
    description: '退货、退款、退回货款',
    example: '我不想要这台打印机了，请帮我退货并退回货款。',
  },
  'price-protection': {
    label: '保价',
    description: '降价保价、申请补差额',
    example: '刚买的同款打印机今天降价了，可以申请保价补差价吗？',
  },
  complaint: {
    label: '投诉',
    description: '投诉。要求登记投诉工单，查询投诉处理进度，反映快递员或客服服务问题。',
    example: '我要投诉快递员服务态度很差，请帮我登记投诉。',
  },
  handoff: {
    label: '转人工',
    description: '转人工客服、人工接管',
    example: '请帮我转接人工客服，我想和真人沟通。',
  },
};

const intentEntries = Object.entries(intents);
const question = {
  type: 'choice',
  instructions: '从候选类别中识别这条中文客服消息最主要的业务意图。',
  criteria: {
    ...Object.fromEntries(intentEntries.map(([id, { description }]) => [id, description])),
    other: '寒暄闲聊、你好、谢谢、再见',
  },
};

export const intentExamples = intentEntries.map(([intent, { example }]) => ({ intent, example }));

/** @typedef {keyof typeof intents | 'other'} Intent */

/**
 * 请求本地 LAYA 识别客服意图，并整理类别、置信度和模型信息。
 * @param {string} text 待分类的用户消息。
 * @param {AbortSignal} [signal] 调用方用于取消本次识别请求的信号。
 * @returns {Promise<{ text: string, intent: Intent, label: string, answerConfidence: number | null, model: string }>}
 */
export async function recognizeIntent(text, signal) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.LAYA_API_KEY) {
    headers.authorization = `Bearer ${process.env.LAYA_API_KEY}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'multilingual',
      lang: 'zh',
      state: text,
      questions: { intent: question },
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`LAYA HTTP ${response.status}：${await response.text()}`);
  }

  const result = await response.json();
  const answer = result.answers?.intent;
  if (!answer || (answer.choice !== 'other' && !Object.hasOwn(intents, answer.choice))) {
    throw new Error('LAYA 返回了无法识别的意图类别');
  }

  /** @type {Intent} */
  const intent = answer.choice;
  return {
    text,
    intent,
    label: intent === 'other' ? '其他' : intents[intent].label,
    answerConfidence: answer.answer_confidence ?? answer.probabilities?.[intent] ?? null,
    model: result.routing?.model ?? result.model,
  };
}

