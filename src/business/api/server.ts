import { createApp } from './app.ts';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT 必须是 1 到 65535 之间的整数');
}

createApp().listen(port, host, () => {
  console.log(`Koa Mock API 已启动：http://${host}:${port}/api/v1`);
});
