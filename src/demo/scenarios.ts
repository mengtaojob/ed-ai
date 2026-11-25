import { findComplaint } from '../business/complaints/index.ts';
import { findHandoff } from '../business/handoff/index.ts';
import { findKnowledgeArticle } from '../business/knowledge/index.ts';
import { findShipmentByOrderId } from '../business/logistics/index.ts';
import { findOrder } from '../business/orders/index.ts';
import { findPriceProtectionExample } from '../business/price-protection/index.ts';
import { findRefundExample } from '../business/refunds/index.ts';

export const demoScenarios = [
  {
    id: 'knowledge',
    title: '知识问答',
    message: '打印机 A 报 E03 怎么办？',
    defaultFixtureId: 'PRINTER-A-E03',
    readFixture: findKnowledgeArticle,
  },
  {
    id: 'order',
    title: '查订单',
    message: '帮我查一下 DEMO-1001 订单。',
    defaultFixtureId: 'DEMO-1001',
    readFixture: findOrder,
  },
  {
    id: 'logistics',
    title: '查物流',
    message: 'DEMO-1002 现在送到哪了？',
    defaultFixtureId: 'DEMO-1002',
    readFixture: findShipmentByOrderId,
  },
  {
    id: 'refund',
    title: '退款',
    message: '打印机和配件都齐全，DEMO-1001 能退吗？',
    defaultFixtureId: 'DEMO-1001',
    readFixture: findRefundExample,
  },
  {
    id: 'price-protection',
    title: '保价',
    message: '我买的打印机降价了，DEMO-1001 能补差价吗？',
    defaultFixtureId: 'DEMO-1001',
    readFixture: findPriceProtectionExample,
  },
  {
    id: 'complaint',
    title: '投诉',
    message: '我想投诉，订单 DEMO-1002 到配送站后一直没派送。',
    defaultFixtureId: 'CMP-DEMO-001',
    readFixture: findComplaint,
  },
  {
    id: 'handoff',
    title: '转人工',
    message: '请转人工客服帮我催一下。',
    defaultFixtureId: 'HOF-DEMO-001',
    readFixture: findHandoff,
  },
];
