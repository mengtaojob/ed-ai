import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const baseURL = process.env.BUSINESS_MOCK_BASE_URL || 'http://127.0.0.1:3000';
const businessResponse = z.object({
  code: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * 创建调用业务 Mock API 的只读查询工具。
 * `id` 是工具名，`description` 说明工具用途，`path` 根据编码后的记录编号生成接口路径，`key` 定义 `recordId` 的校验规则。
 */
function lookupTool(id: string, description: string, path: (id: string) => string, key: z.ZodType<string>) {
  return createTool({
    id,
    description,
    inputSchema: z.object({ recordId: key }),
    outputSchema: businessResponse,
    /** 通过业务接口查询 `recordId` 对应的记录，`context` 提供本次工具调用的取消信号。 */
    execute: async ({ recordId }, context) => {
      const timeout = AbortSignal.timeout(5_000);
      const signal = context?.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout;
      try {
        const response = await fetch(new URL(`/api/v1${path(encodeURIComponent(recordId))}`, baseURL), { signal });
        if (response.ok || response.status === 404) {
          return businessResponse.parse(await response.json());
        }
      } catch {
        context?.abortSignal?.throwIfAborted();
      }
      return { code: 'BUSINESS_UNAVAILABLE', message: '业务查询暂不可用，请稍后再试。', data: null };
    },
  });
}

const orderId = z.string().regex(/^DEMO-\d+$/).describe('用户提供的完整订单号，例如 DEMO-1001');

export const businessTools = {
  lookup_knowledge: lookupTool(
    'lookup_knowledge',
    '查询客服知识条目及出处。根据问题选择条目。',
    (id) => `/knowledge/${id}`,
    z.enum(['PRINTER-A', 'PRINTER-A-E03', 'RETURN-POLICY', 'PRICE-PROTECTION-POLICY'])
      .describe('PRINTER-A 产品规格和墨盒；PRINTER-A-E03 卡纸和 E03；RETURN-POLICY 退款政策；PRICE-PROTECTION-POLICY 保价政策'),
  ),
  lookup_order: lookupTool('lookup_order', '查询订单商品、实付金额和订单状态。', (id) => `/orders/${id}`, orderId),
  lookup_logistics: lookupTool('lookup_logistics', '按订单号查询运单、物流轨迹和最新派送进度。', (id) => `/orders/${id}/logistics`, orderId),
  lookup_refund: lookupTool('lookup_refund', '按订单号查询模拟退款资格、预估金额及原因。', (id) => `/orders/${id}/refund`, orderId),
  lookup_price_protection: lookupTool('lookup_price_protection', '按订单号查询模拟保价资格、当前售价和预估差额。', (id) => `/orders/${id}/price-protection`, orderId),
  lookup_complaint: lookupTool(
    'lookup_complaint', '按投诉编号查询已有投诉记录。', (id) => `/complaints/${id}`,
    z.string().regex(/^CMP-DEMO-\d+$/).describe('用户提供的完整投诉编号，例如 CMP-DEMO-001'),
  ),
  lookup_handoff: lookupTool(
    'lookup_handoff', '按记录编号查询已有模拟转人工记录。', (id) => `/handoffs/${id}`,
    z.string().regex(/^HOF-DEMO-\d+$/).describe('用户提供的完整转人工记录编号，例如 HOF-DEMO-001'),
  ),
};
