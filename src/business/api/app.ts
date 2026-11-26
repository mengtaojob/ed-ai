import Router, { type RouterContext } from '@koa/router';
import Koa, { type Context, type Next } from 'koa';
import { findComplaint } from '../complaints/index.ts';
import { findHandoff } from '../handoff/index.ts';
import { findKnowledgeArticle } from '../knowledge/index.ts';
import { findShipmentByOrderId } from '../logistics/index.ts';
import { findOrder } from '../orders/index.ts';
import { findPriceProtectionExample } from '../price-protection/index.ts';
import { findRefundExample } from '../refunds/index.ts';

type ApiError = readonly [code: string, message: string];

const orderNotFound = ['ORDER_NOT_FOUND', '未找到该订单'] as const;
const routingErrors: Partial<Record<number, ApiError>> = {
  404: ['ROUTE_NOT_FOUND', '未找到该接口'],
  405: ['METHOD_NOT_ALLOWED', '该接口不支持此请求方法'],
  501: ['METHOD_NOT_IMPLEMENTED', '服务不支持此请求方法'],
};

/** 向 Koa 上下文 `ctx` 写入 HTTP 200 响应，`data` 是查询结果或健康检查数据。 */
function sendSuccess(ctx: Context, data: unknown): void {
  ctx.status = 200;
  ctx.body = { code: 'OK', message: '成功', data };
}

/** 向 Koa 上下文 `ctx` 写入错误响应，`status` 是 HTTP 状态码，`code` 和 `message` 分别是业务错误码和提示。 */
function sendError(ctx: Context, status: number, [code, message]: ApiError): void {
  ctx.status = status;
  ctx.body = { code, message, data: null };
}

/** 创建按路由编号查询记录的处理函数，`find` 接收编号并查找记录，`notFound` 指定无匹配记录时返回的业务错误。 */
function readRecord<T>(find: (id: string) => T | undefined, notFound: ApiError) {
  return (ctx: RouterContext): void => {
    const record = find(ctx.params.id);
    if (record === undefined) {
      sendError(ctx, 404, notFound);
      return;
    }

    sendSuccess(ctx, record);
  };
}

/** 检查路由上下文 `ctx` 中的订单号，订单存在时调用 `next` 继续查询，否则返回 404。 */
async function requireOrder(ctx: RouterContext, next: Next): Promise<void> {
  if (findOrder(ctx.params.id) === undefined) {
    sendError(ctx, 404, orderNotFound);
    return;
  }

  await next();
}

/** 调用 `next` 执行下游中间件，再通过 `ctx` 统一处理 OPTIONS 成功响应、无响应体的路由错误和异常。 */
async function formatResponse(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (error) {
    ctx.app.emit('error', error instanceof Error ? error : new Error(String(error)), ctx);
    sendError(ctx, 500, ['INTERNAL_ERROR', '服务处理请求时出错']);
    return;
  }

  if (ctx.method === 'OPTIONS' && ctx.status === 200) {
    sendSuccess(ctx, null);
    return;
  }

  const routingError = routingErrors[ctx.status];
  if (ctx.body == null && routingError !== undefined) {
    sendError(ctx, ctx.status, routingError);
  }
}

/** 创建 Koa 应用，注册业务查询接口和统一响应中间件。 */
export function createApp(): Koa {
  const app = new Koa();
  const router = new Router({ prefix: '/api/v1' });

  router.get('/health', (ctx) => sendSuccess(ctx, { status: 'ok' }));
  router.get('/orders/:id', readRecord(findOrder, orderNotFound));
  router.get('/orders/:id/logistics', requireOrder,
    readRecord(findShipmentByOrderId, ['SHIPMENT_NOT_FOUND', '该订单暂无物流记录']));
  router.get('/orders/:id/refund', requireOrder,
    readRecord(findRefundExample, ['REFUND_EXAMPLE_NOT_FOUND', '该订单暂无退款样例']));
  router.get('/orders/:id/price-protection', requireOrder,
    readRecord(findPriceProtectionExample, ['PRICE_PROTECTION_EXAMPLE_NOT_FOUND', '该订单暂无保价样例']));
  router.get('/knowledge/:id',
    readRecord(findKnowledgeArticle, ['ARTICLE_NOT_FOUND', '未找到该知识条目']));
  router.get('/complaints/:id',
    readRecord(findComplaint, ['COMPLAINT_NOT_FOUND', '未找到该投诉记录']));
  router.get('/handoffs/:id',
    readRecord(findHandoff, ['HANDOFF_NOT_FOUND', '未找到该转人工记录']));

  app.use(formatResponse);
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
