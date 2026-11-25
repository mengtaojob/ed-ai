const baseUrl = process.env.LAYA_BASE_URL || 'http://127.0.0.1:8000';
const endpoint = new URL('/v1/systemone', baseUrl);

const intents = {
  knowledge: {
    label: '知识问答',
    description: '咨询产品功能、操作步骤、故障排查或通用政策。',
    example: '打印机报 E03，怎么排查卡纸？',
  },
  order: {
    label: '查订单',
    description: '查询订单详情、购买商品、付款金额或订单状态。',
    example: '帮我查一下 DEMO-1001 买了什么、实付多少钱。',
  },
  logistics: {
    label: '查物流',
    description: '查询运单、包裹位置、派送进度或预计送达时间。',
    example: '我的包裹现在到哪个配送站了，什么时候能送到？',
  },
  refund: {
    label: '退款',
    description: '申请退货退款、退回货款或查询退款进度。',
    example: '我不想要这台打印机了，请帮我退货并退回货款。',
  },
  'price-protection': {
    label: '保价',
    description: '商品购买后降价，申请价格保护并补回差价。',
    example: '刚买的同款打印机今天降价了，可以申请保价补差价吗？',
  },
  complaint: {
    label: '投诉',
    description: '对商品、配送或客服服务表达不满并要求登记投诉。',
    example: '我要投诉快递员服务态度很差，请帮我登记投诉。',
  },
  handoff: {
    label: '转人工',
    description: '要求转接人工客服、与真人沟通或请人工接手当前会话。',
    example: '请帮我转接人工客服，我想和真人沟通。',
  },
};

const intentEntries = Object.entries(intents);
const question = {
  type: 'choice',
  instructions: '从候选类别中识别这条中文客服消息最主要的业务意图。',
  criteria: Object.fromEntries(
    intentEntries.map(([id, { label, description }]) => [id, `${label}。${description}`]),
  ),
};

async function recognizeIntent(text) {
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
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`LAYA HTTP ${response.status}：${await response.text()}`);
  }

  const result = await response.json();
  const answer = result.answers?.intent;
  if (!answer || !Object.hasOwn(intents, answer.choice)) {
    throw new Error('LAYA 返回了无法识别的意图类别');
  }

  return {
    text,
    intent: answer.choice,
    label: intents[answer.choice].label,
    answerConfidence: answer.answer_confidence ?? answer.probabilities?.[answer.choice],
    model: result.routing?.model ?? result.model,
  };
}

async function runDemo() {
  const text = process.argv.slice(2).join(' ').trim();
  if (text) {
    console.log(JSON.stringify(await recognizeIntent(text), null, 2));
    return;
  }

  const results = [];
  for (const [expected, { example }] of intentEntries) {
    const result = await recognizeIntent(example);
    results.push({ ...result, expected, passed: result.intent === expected });
  }
  console.table(results);
  if (results.some(({ passed }) => !passed)) {
    process.exitCode = 1;
  }
}

try {
  await runDemo();
} catch (error) {
  console.error(`调用 ${endpoint.href} 失败：${error.message}`);
  process.exitCode = 1;
}
