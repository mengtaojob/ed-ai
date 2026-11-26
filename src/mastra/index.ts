import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { supportAgent } from '../agents/support-agent.ts';
import { ollamaGateway } from './gateways/ollama.ts';

export const mastra = new Mastra({
  agents: { supportAgent },
  gateways: { ollamaGateway },
  storage: new InMemoryStore(),
  server: { host: '127.0.0.1', port: 4111 },
});
