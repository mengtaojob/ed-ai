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

function sendSuccess(ctx: Context, data: unknown): void {
  ctx.status = 200;
  ctx.body = { code: 'OK', message: '成功', data };
}

function sendError(ctx: Context, status: number, [code, message]: ApiError): void {
  ctx.status = status;
  ctx.body = { code, message, data: null };
}

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

async function requireOrder(ctx: RouterContext, next: Next): Promise<void> {
  if (findOrder(ctx.params.id) === undefined) {
    sendError(ctx, 404, orderNotFound);
    return;
  }

  await next();
}

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
