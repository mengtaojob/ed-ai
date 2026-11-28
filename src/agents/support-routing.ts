import type { ProcessInputStepArgs, ProcessInputStepResult, ProcessLLMRequestArgs, Processor } from '@mastra/core/processors';
import { recognizeIntent } from '../../model-services/laya/client.mjs';
import type { businessTools } from './tools/business-tools.ts';
import type { knowledgeTools } from './tools/knowledge-tool.ts';

type Intent = Awaited<ReturnType<typeof recognizeIntent>>['intent'];
type ToolName = keyof (typeof businessTools & typeof knowledgeTools);

const routes = {
  knowledge: { tool: 'searchKnowledge' },
  order: { tool: 'lookup_order', prefix: 'DEMO-', field: '订单号' },
  logistics: { tool: 'lookup_logistics', prefix: 'DEMO-', field: '订单号' },
  refund: { tool: 'lookup_refund', prefix: 'DEMO-', field: '订单号' },
  'price-protection': { tool: 'lookup_price_protection', prefix: 'DEMO-', field: '订单号' },
  complaint: { tool: 'lookup_complaint', prefix: 'CMP-DEMO-', field: '投诉编号' },
  handoff: { tool: 'lookup_handoff', prefix: 'HOF-DEMO-', field: '转人工记录编号' },
} satisfies Record<Exclude<Intent, 'other'>, { tool: ToolName; prefix?: string; field?: string }>;

const recordIdPattern = /\b(?:CMP-|HOF-)?DEMO-\d+\b/gi;
const idReplyPattern = /^(?:(?:我的)?(?:编号|单号|订单号|投诉编号|记录编号)\s*(?:是|为|[:：])?\s*)?((?:CMP-|HOF-)?DEMO-\d+)[。！？.!?\s]*$/i;

/** 根据 `recordId` 的前缀选择默认查询工具，投诉和转人工编号走各自的工具，订单号默认查物流。 */
function defaultToolForId(recordId: string): ToolName {
  if (recordId.startsWith(routes.complaint.prefix)) return routes.complaint.tool;
  if (recordId.startsWith(routes.handoff.prefix)) return routes.handoff.tool;
  return routes.logistics.tool;
}

export const supportRouting = {
  id: 'laya-support-routing',
  name: 'LAYA 意图路由',
  /**
   * 在首步识别意图并选择查询工具或追问编号，后续步骤只让模型根据工具结果作答。
   * `messages` 是会话消息，`systemMessages` 是已有系统指令，`stepNumber` 是从 0 开始的步骤序号，`abortSignal` 用于取消意图识别，`state` 用于在处理器钩子间共享状态。
   */
  async processInputStep({ messages, systemMessages, stepNumber, abortSignal, state }: ProcessInputStepArgs): Promise<ProcessInputStepResult> {
    if (stepNumber > 0) {
      return {
        toolChoice: 'none',
        systemMessages: [...systemMessages, {
          role: 'system',
          content: '只回复本轮工具查询结果。回答完即可结束，不要继续处理旧话题或索要其他业务编号。',
        }],
      };
    }

    // Studio 可能通过 signal 传入用户消息，这里只提取用户发出的文本。
    const userMessages = messages.filter(({ role, content }) => {
      if (role === 'user') return true;
      const signal = content.metadata?.signal;
      return role === 'signal' && typeof signal === 'object' && signal !== null && 'type' in signal
        && (signal.type === 'user' || signal.type === 'user-message');
    }).map(({ content }) =>
      content.parts?.flatMap((part) => part.type === 'text' ? [part.text] : []).join(' ').trim() || '',
    ).filter(Boolean);
    const latest = userMessages.at(-1);

    /** 将 `instruction` 追加为系统指令，指定 `tool` 时只启用并强制调用该工具，省略时禁用工具。 */
    function route(instruction: string, tool?: ToolName): ProcessInputStepResult {
      return {
        systemMessages: [...systemMessages, { role: 'system', content: instruction }],
        activeTools: tool ? [tool] : [],
        toolChoice: tool ? { type: 'tool', toolName: tool } : 'none',
      };
    }

    /** 指示模型用 `tool` 查询指定的 `recordId`，`context` 是可选的前置说明，例如识别到的意图。 */
    function lookup(tool: ToolName, recordId: string, context = ''): ProcessInputStepResult {
      return route(`${context}请先调用 ${tool}，将用户提供的 ${recordId} 原样传入 recordId。`, tool);
    }

    /** 按原问题检索知识。通用政策与产品知识用同一个查询工具。 */
    function retrieveKnowledge(label: string): ProcessInputStepResult {
      return route(`LAYA 识别为${label}。请调用 searchKnowledge，把本轮用户的完整问题原样传给 query。`, 'searchKnowledge');
    }

    if (!latest) return route('请用户用文字描述要咨询的问题。');

    const previous = userMessages.at(-2);
    const suppliedId = idReplyPattern.exec(latest)?.[1]?.toUpperCase();
    if (suppliedId && (!previous || idReplyPattern.test(previous))) {
      return lookup(defaultToolForId(suppliedId), suppliedId);
    }

    // 用户只补发编号时，识别上一条消息的意图，再用编号匹配该意图对应的工具。
    const input = suppliedId && previous ? previous : latest;
    let decision: Awaited<ReturnType<typeof recognizeIntent>>;
    try {
      decision = await recognizeIntent(input, abortSignal);
    } catch (error) {
      abortSignal?.throwIfAborted();
      console.warn('[LAYA] 意图识别失败', error);
      return route('意图识别服务暂时不可用，请告知用户稍后再试。');
    }

    console.info(`[LAYA] ${decision.model} → ${decision.intent} (${decision.answerConfidence ?? 'n/a'})`);
    const selected = decision.intent === 'other' ? undefined : routes[decision.intent];
    if (suppliedId) {
      if (selected && 'prefix' in selected && suppliedId.startsWith(selected.prefix)) {
        return lookup(selected.tool, suppliedId, `LAYA 识别为${decision.label}。`);
      }
      state.ignorePriorTurns = true;
      return lookup(defaultToolForId(suppliedId), suppliedId);
    }

    if (!selected) {
      return route('用户暂未提出明确的店铺业务请求。礼貌回应，并询问需要什么帮助。');
    }

    if (!('prefix' in selected)) {
      return retrieveKnowledge(decision.label);
    }
    // 通用政策即使在查过订单的会话中也查原文。当前消息明确包含订单号时仍走按单查询。
    if ((decision.intent === 'refund' || decision.intent === 'price-protection')
      && /政策|规则|期限|几天|多久|什么条件|哪些条件|怎么申请|如何申请/.test(latest)
      && ![...latest.matchAll(recordIdPattern)].some(([id]) => id.toUpperCase().startsWith(selected.prefix))) {
      return retrieveKnowledge(decision.label);
    }

    const recordId = userMessages.slice(-4).reverse()
      .flatMap((text) => [...text.toUpperCase().matchAll(recordIdPattern)].map(([id]) => id))
      .find((id) => id.startsWith(selected.prefix));
    if (!recordId) {
      const readOnly = decision.intent === 'complaint' || decision.intent === 'handoff'
        ? '当前可查询已有模拟记录。'
        : '';
      return route(`LAYA 识别为${decision.label}。${readOnly}请向用户索要${selected.field}，只问这一种编号。`);
    }

    return lookup(selected.tool, recordId, `LAYA 识别为${decision.label}。`);
  },
  /** `prompt` 是即将发给模型的消息，`state.ignorePriorTurns` 为真时只保留系统指令和当前轮内容。 */
  processLLMRequest({ prompt, state }: ProcessLLMRequestArgs) {
    if (!state.ignorePriorTurns) return;

    // 只裁剪本次发给 Qwen 的消息，会话历史仍保存在内存中。
    const currentTurn = prompt.map(({ role }) => role).lastIndexOf('user');
    if (currentTurn >= 0) {
      return { prompt: prompt.filter(({ role }, index) => role === 'system' || index >= currentTurn) };
    }
  },
} satisfies Processor;
