import {
  REPROCESS_PART_KEY, type Processor, type ProcessOutputStreamArgs, type ProcessToolResultArgs,
} from '@mastra/core/processors';
import { searchResultSchema, type SearchResult } from '../knowledge/search.ts';

export const knowledgeRouteKey = 'support.knowledge-route';
export const insufficientKnowledge = '现有资料不足以确认这个问题。';
const unavailableKnowledge = '知识库暂时不可用，请稍后再试。';

/** 检查模型给出的资料 ID。出处名称从本轮证据生成，缺引用或含外部 ID 时使用保守答复。 */
export function validateKnowledgeCitations(draft: string, result: SearchResult): string {
  if (result.status === 'unavailable') return unavailableKnowledge;
  if (result.status === 'insufficient_evidence' || !result.evidence.length) return insufficientKnowledge;

  const marker = /^[ \t]*(?:\*\*)?出处(?:\*\*)?\s*[:：]/m.exec(draft);
  if (!marker) return insufficientKnowledge;
  const body = draft.slice(0, marker.index).trim();
  const sourceLine = draft.slice(marker.index);
  const citationId = /\[([^\]\r\n]+)\]|(?<![A-Za-z0-9-])([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(?![A-Za-z0-9-])/g;
  const ids = [...new Set([...sourceLine.matchAll(citationId)].map(([, bracketed, plain]) => (bracketed ?? plain).trim()))];
  const allowed = new Map(result.evidence.map(({ id, source }) => [id, source]));
  if (!body || !ids.length || /\[[A-Z][A-Z0-9-]+\]/.test(body) || ids.some((id) => !allowed.has(id))) {
    return insufficientKnowledge;
  }
  return `${body}\n\n出处：${ids.map((id) => `[${id}] ${allowed.get(id)}`).join('；')}`;
}

export const knowledgeCitations = {
  id: 'support-knowledge-citations',
  name: '校验本轮知识引用',
  /** 从当前工具调用保存证据白名单；处理器 state 属于一次请求，历史消息不能提供引用。 */
  processToolResult({ toolName, result, state }: ProcessToolResultArgs) {
    if (toolName !== 'searchKnowledge') return;
    const parsed = searchResultSchema.safeParse(result);
    state.knowledge = parsed.success ? parsed.data : { status: 'unavailable', evidence: [], trace: null };
  },
  /** 缓存知识答复，校验后才发给 Studio 或 API。业务查询仍按原样输出。 */
  async processOutputStream({ part, state, requestContext }: ProcessOutputStreamArgs) {
    const result = state.knowledge as SearchResult | undefined;
    if (!result && !requestContext?.get(knowledgeRouteKey)) return part;
    if (part.type === 'text-delta') {
      // 重新驱动的 text-end 与已校验输出分开，保证流中引用不会被拆成未校验的片段。
      state.draft = (typeof state.draft === 'string' ? state.draft : '') + part.payload.text;
      return null;
    }
    if (part.type !== 'text-end' || typeof state.draft !== 'string') return part;
    const draft = state.draft;
    delete state.draft;
    if (!result) return part;

    // Mastra 会先输出这里返回的文本，再补发同一个文本块的结束事件。
    state[REPROCESS_PART_KEY] = part;
    return { ...part, type: 'text-delta', payload: {
      id: part.payload.id,
      text: validateKnowledgeCitations(draft, result),
    } };
  },
} satisfies Processor;
