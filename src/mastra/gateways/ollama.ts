import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MastraModelGatewayInterface } from '@mastra/core/llm';

const baseURL = process.env.OLLAMA_OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
const modelId = 'qwen3.5:4b';

export const supportModel = `local/ollama/${modelId}` as const;

export const ollamaGateway: MastraModelGatewayInterface = {
  id: 'local',
  name: 'Local Ollama',
  /** 向 Mastra 登记本地 Ollama 提供方、可用模型和服务地址。 */
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
  /** 创建连接 Ollama 的聊天模型，`modelId` 指定模型，`providerId` 用作客户端的提供方名称。 */
  resolveLanguageModel: ({ modelId, providerId }) => createOpenAICompatible({
    name: providerId,
    baseURL,
    /** 在待发往 Ollama 的请求体 `body` 中设置 `reasoning_effort`，关闭额外推理。 */
    transformRequestBody: (body) => ({ ...body, reasoning_effort: 'none' }),
  }).chatModel(modelId),
};
