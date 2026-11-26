import type { ProcessInputStepArgs, ProcessInputStepResult, Processor } from '@mastra/core/processors';
import { recognizeIntent } from '../../model-services/laya/client.mjs';
import type { businessTools } from './tools/business-tools.ts';

type Intent = Awaited<ReturnType<typeof recognizeIntent>>['intent'];
type ToolName = keyof typeof businessTools;

const routes = {
  knowledge: { tool: 'lookup_knowledge' },
  order: { tool: 'lookup_order', prefix: 'DEMO-', field: '订单号' },
  logistics: { tool: 'lookup_logistics', prefix: 'DEMO-', field: '订单号' },
  refund: { tool: 'lookup_refund', prefix: 'DEMO-', field: '订单号' },
  'price-protection': { tool: 'lookup_price_protection', prefix: 'DEMO-', field: '订单号' },
  complaint: { tool: 'lookup_complaint', prefix: 'CMP-DEMO-', field: '投诉编号' },
  handoff: { tool: 'lookup_handoff', prefix: 'HOF-DEMO-', field: '转人工记录编号' },
} satisfies Record<Exclude<Intent, 'other'>, { tool: ToolName; prefix?: string; field?: string }>;

const recordIdPattern = /\b(?:CMP-|HOF-)?DEMO-\d+\b/gi;
const idReplyPattern = /^(?:(?:编号|单号|订单号|投诉编号|记录编号)\s*(?:是|为|[:：])?\s*)?(?:CMP-|HOF-)?DEMO-\d+[。！!\s]*$/i;

export const supportRouting = {
  id: 'laya-support-routing',
  name: 'LAYA 意图路由',
  async processInputStep({ messages, systemMessages, stepNumber, abortSignal }: ProcessInputStepArgs): Promise<ProcessInputStepResult> {
    if (stepNumber > 0) return { toolChoice: 'none' };

    // Studio sends user turns as signals. Exclude system and tool signals from routing.
    const userMessages = messages.filter(({ role, content }) => {
      if (role === 'user') return true;
      const signal = content.metadata?.signal;
      return role === 'signal' && typeof signal === 'object' && signal !== null && 'type' in signal
        && (signal.type === 'user' || signal.type === 'user-message');
    }).map(({ content }) =>
      content.parts?.flatMap((part) => part.type === 'text' ? [part.text] : []).join(' ').trim() || '',
    ).filter(Boolean);
    const latest = userMessages.at(-1);

    function route(instruction: string, tool?: ToolName): ProcessInputStepResult {
      return {
        systemMessages: [...systemMessages, { role: 'system', content: instruction }],
        activeTools: tool ? [tool] : [],
        toolChoice: tool ? { type: 'tool', toolName: tool } : 'none',
      };
    }

    if (!latest) return route('请用户用文字描述要咨询的问题。');

    const previous = userMessages.at(-2);
    // A bare ID supplies the lookup key. The preceding request still supplies the intent.
    const input = previous && idReplyPattern.test(latest) ? previous : latest;
    let decision: Awaited<ReturnType<typeof recognizeIntent>>;
    try {
      decision = await recognizeIntent(input, abortSignal);
    } catch (error) {
      abortSignal?.throwIfAborted();
      console.warn('[LAYA] 意图识别失败', error);
      return route('意图识别服务暂时不可用，请告知用户稍后再试。');
    }

    console.info(`[LAYA] ${decision.model} → ${decision.intent} (${decision.answerConfidence ?? 'n/a'})`);
    if (decision.intent === 'other') {
      return route('用户暂未提出明确的店铺业务请求。礼貌回应，并询问需要什么帮助。');
    }

    const selected = routes[decision.intent];
    if (!('prefix' in selected)) {
      return route(`LAYA 识别为${decision.label}。请先选择相关知识条目并调用 ${selected.tool}。`, selected.tool);
    }

    const recordId = userMessages.slice(-4).reverse()
      .flatMap((text) => [...text.toUpperCase().matchAll(recordIdPattern)].map(([id]) => id))
      .find((id) => id.startsWith(selected.prefix));
    if (!recordId) {
      if (/(?:政策|规则|期限|几天|多久)/.test(latest)
        && (decision.intent === 'refund' || decision.intent === 'price-protection')) {
        const article = decision.intent === 'refund' ? 'RETURN-POLICY' : 'PRICE-PROTECTION-POLICY';
        return route(`LAYA 识别为${decision.label}。用户在询问通用政策，请先调用 lookup_knowledge，recordId 为 ${article}。`, 'lookup_knowledge');
      }
      const readOnly = decision.intent === 'complaint' || decision.intent === 'handoff'
        ? '当前可查询已有模拟记录。'
        : '';
      return route(`LAYA 识别为${decision.label}。${readOnly}请向用户索要${selected.field}，只问这一种编号。`);
    }

    return route(
      `LAYA 识别为${decision.label}。请先调用 ${selected.tool}，将用户提供的 ${recordId} 原样传入 recordId。`,
      selected.tool,
    );
  },
} satisfies Processor;
