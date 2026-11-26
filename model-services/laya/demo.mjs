import { intentExamples, recognizeIntent } from './client.mjs';

async function runDemo() {
  const text = process.argv.slice(2).join(' ').trim();
  if (text) {
    console.log(JSON.stringify(await recognizeIntent(text), null, 2));
    return;
  }

  const results = [];
  for (const { intent: expected, example } of intentExamples) {
    const result = await recognizeIntent(example);
    results.push({ ...result, expected, passed: result.intent === expected });
  }
  console.table(results);
  if (results.some(({ passed }) => !passed)) {
    process.exitCode = 1;
  }
}

try {
  await runDemo();
} catch (error) {
  console.error(`调用 LAYA 失败：${error.message}`);
  process.exitCode = 1;
}
