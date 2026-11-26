import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MastraModelGatewayInterface } from '@mastra/core/llm';

const baseURL = process.env.OLLAMA_OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
const modelId = 'qwen3.5:4b';

export const supportModel = `local/ollama/${modelId}` as const;

export const ollamaGateway: MastraModelGatewayInterface = {
  id: 'local',
  name: 'Local Ollama',
  fetchProviders: async () => ({
    ollama: {
      name: 'Ollama',
      models: [modelId],
      apiKeyEnvVar: [],
      gateway: 'local',
      url: baseURL,
    },
  }),
  buildUrl: () => baseURL,
  getApiKey: async () => '',
  resolveLanguageModel: ({ modelId, providerId }) => createOpenAICompatible({
    name: providerId,
    baseURL,
    transformRequestBody: (body) => ({ ...body, reasoning_effort: 'none' }),
  }).chatModel(modelId),
};
