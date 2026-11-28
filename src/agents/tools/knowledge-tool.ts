import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { articleSchema, searchKnowledge } from '../../knowledge/search.ts';

const searchResult = z.object({
  status: z.enum(['ok', 'insufficient_evidence', 'unavailable']),
  evidence: z.array(articleSchema.extend({ score: z.number() })),
});

export const knowledgeTools = {
  searchKnowledge: createTool({
    id: 'searchKnowledge',
    description: '根据用户的自然语言问题查询打印机、耗材、故障及通用售后政策，返回原文和出处。',
    inputSchema: z.object({ query: z.string().trim().min(1).max(2_000).describe('用户的自然语言知识问题') }),
    outputSchema: searchResult,
    /** query 是用户问句，工具只读知识库。查询异常由 Agent 告知用户，保留日志供本地排查。 */
    async execute({ query }, context): Promise<z.infer<typeof searchResult>> {
      try {
        const evidence = await searchKnowledge(query, context?.abortSignal);
        return { status: evidence.length ? 'ok' : 'insufficient_evidence', evidence };
      } catch (error) {
        context?.abortSignal?.throwIfAborted();
        console.warn('[searchKnowledge] 查询失败', error);
        return { status: 'unavailable', evidence: [] };
      }
    },
  }),
};
