import { demoScenarios } from './scenarios.ts';

/** 按场景标识 `scenarioId` 预览本地样例，`fixtureId` 是可选的记录编号，省略时使用该场景的默认样例。未指定场景时列出所有场景。 */
function previewScenario(scenarioId: string | undefined, fixtureId: string | undefined): void {
  if (scenarioId === undefined) {
    for (const scenario of demoScenarios) {
      console.log(`${scenario.id} | ${scenario.title} | ${scenario.message}`);
    }
    return;
  }

  const scenario = demoScenarios.find(({ id }) => id === scenarioId);

  if (scenario === undefined) {
    console.error(`未知场景：${scenarioId}。运行 npm run demo 查看场景列表。`);
    process.exitCode = 1;
    return;
  }

  const requestedId = fixtureId ?? scenario.defaultFixtureId;
  const fixture = scenario.readFixture(requestedId);

  if (fixture === undefined) {
    console.error(`未找到「${scenario.title}」的演示数据：${requestedId}`);
    process.exitCode = 1;
    return;
  }

  const preview = {
    id: scenario.id,
    title: scenario.title,
    fixtureId: requestedId,
    fixture,
  };
  console.log(JSON.stringify(preview, null, 2));
}

previewScenario(process.argv[2], process.argv[3]);
