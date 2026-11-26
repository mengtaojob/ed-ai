import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { supportModel } from '../mastra/gateways/ollama.ts';
import { supportInstructions } from './prompts/support.ts';
import { supportRouting } from './support-routing.ts';
import { businessTools } from './tools/business-tools.ts';

/** 组装本地客服 Agent，使用 LAYA 路由选择业务工具，由 Ollama 模型根据查询结果组织答复。 */
export const supportAgent = new Agent({
  id: 'support-agent',
  name: '本地客服 Agent',
  instructions: supportInstructions,
  model: supportModel,
  tools: businessTools,
  inputProcessors: [supportRouting],
  memory: new Memory({ options: { lastMessages: 8, generateTitle: false } }),
  defaultOptions: { maxSteps: 2, modelSettings: { temperature: 0, maxOutputTokens: 512 } },
});
