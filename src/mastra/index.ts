import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { supportAgent } from '../agents/support-agent.ts';
import { ollamaGateway } from './gateways/ollama.ts';

/** 初始化 Mastra，注册客服 Agent、本地 Ollama 网关和进程内存储。 */
export const mastra = new Mastra({
  agents: { supportAgent },
  gateways: { ollamaGateway },
  storage: new InMemoryStore(),
  server: { host: '127.0.0.1', port: 4111 },
});
