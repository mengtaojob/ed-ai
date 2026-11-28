import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchKnowledge, searchResultSchema, type SearchResult } from '../../knowledge/search.ts';

export const knowledgeTools = {
  searchKnowledge: createTool({
    id: 'searchKnowledge',
    description: '根据用户的自然语言问题查询打印机、耗材、故障及通用售后政策，返回原文和出处。',
    inputSchema: z.object({ query: z.string().trim().min(1).max(2_000).describe('用户的自然语言知识问题') }),
    outputSchema: searchResultSchema,
    // Studio 和 API 保留召回及重排轨迹，Qwen 只看到状态和最终原文。
    toModelOutput: ({ status, evidence }) => ({
      type: 'json',
      value: {
        status,
        evidence: evidence.map(({ id, title, content, source }) => ({ id, title, content, source })),
      },
    }),
    /** query 是用户问句，工具只读知识库。查询异常由 Agent 告知用户，保留日志供本地排查。 */
    async execute({ query }, context): Promise<SearchResult> {
      try {
        return await searchKnowledge(query, context?.abortSignal);
      } catch (error) {
        context?.abortSignal?.throwIfAborted();
        console.warn('[searchKnowledge] 查询失败', error);
        return { status: 'unavailable', evidence: [], trace: null };
      }
    },
  }),
};
