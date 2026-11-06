const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouterService } = require('../services/routerService');

test('Windows requests receive a platform warning without execution', async () => {
  const router = createRouterService({ workspaceRoot: '/tmp/eai-router-test' });
  const result = await router.routeCommand('1', 'windows', 'format C:');
  assert.match(result, /not available in this Linux Codespace/);
  assert.match(result, /no command was executed/);
});

test('terminal rejects commands outside the fixed read-only allowlist', async () => {
  const router = createRouterService({ workspaceRoot: '/tmp/eai-router-test' });
  await assert.rejects(router.routeCommand('1', 'dev', 'npm install'), { status: 403 });
});
