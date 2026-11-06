const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { prepareDatabase } = require('../server');
const { createApp } = require('../app');
const { createExtensionService } = require('../services/extensionService');
const { createTokenService } = require('../services/tokenService');

test('gateway authenticates tenants, routes to private workers, and accounts for successful actions', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'eai-gateway-'));
  const config = {
    vaultDir: path.join(tmp, 'vault'), dbPath: path.join(tmp, 'vault', 'system.sqlite'),
    backupPath: null, workspaceRoot: path.join(tmp, 'workspaces'), publicUiOrigin: 'http://localhost:8080',
  };
  const db = prepareDatabase(config);
  const secret = 'a-jwt-secret-that-is-long-enough-for-tests';
  process.env.JWT_SECRET = secret;
  process.env.GENESIS_ADMIN_PASSWORD = 'a-secure-genesis-password';
  db.prepare("INSERT INTO users (username, password_hash) VALUES ('alice', 'unused'), ('bob', 'unused')").run();
  const alice = db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
  const bob = db.prepare("SELECT id FROM users WHERE username = 'bob'").get().id;
  const tokens = createTokenService(db);
  const extensions = createExtensionService({ db, workspaceRoot: config.workspaceRoot, tokens });
  const app = createApp({ db, config, tokens, extensions });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await extensions.close();
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const makeToken = (id, username) => jwt.sign({ sub: String(id), username }, secret, {
    issuer: 'eai-digital-twin', audience: 'eai-ui', expiresIn: '15m',
  });
  const aliceToken = makeToken(alice, 'alice');
  const bobToken = makeToken(bob, 'bob');
  async function request(url, token, body) {
    return fetch(origin + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  assert.equal((await request('/api/extensions', null, {})).status, 401);
  assert.equal((await request('/api/workspace/tree', aliceToken)).status, 200);
  const creation = await request('/api/extensions', aliceToken, {});
  assert.equal(creation.status, 201);
  assert.deepEqual(await creation.json(), { created: true, tokenBalance: 10 });
  const again = await request('/api/extensions', aliceToken, {});
  assert.deepEqual(await again.json(), { created: false, tokenBalance: 10 });

  const alicePort = db.prepare('SELECT port FROM tenant_workspaces WHERE user_id = ?').get(alice).port;
  assert.equal((await fetch(`http://127.0.0.1:${alicePort}/api/workspace/tree`)).status, 403);
  assert.equal((await request('/api/workspace/file', aliceToken, { path: 'file.txt', content: 'alice only' })).status, 200);
  const file = await request('/api/workspace/file?path=file.txt', aliceToken);
  assert.deepEqual(await file.json(), { content: 'alice only' });
  assert.equal((await request('/api/workspace/file?path=file.txt', bobToken)).status, 404);
  assert.equal((await request('/api/workspace/file?path=../vault/system.sqlite', aliceToken)).status, 400);
  const simultaneous = await Promise.all([
    request('/api/extensions', bobToken, {}),
    request('/api/extensions', bobToken, {}),
  ]);
  assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 201]);
  assert.equal(tokens.getBalance(bob), 10);
  const bobPort = db.prepare('SELECT port FROM tenant_workspaces WHERE user_id = ?').get(bob).port;
  assert.notEqual(alicePort, bobPort);
  assert.equal((await request('/api/workspace/file?path=file.txt', bobToken)).status, 404);

  const terminal = await request('/api/terminal', aliceToken, { systemType: 'dev', command: 'node --version' });
  assert.equal(terminal.status, 200);
  assert.equal(tokens.getBalance(alice), 20);
  assert.equal((await request('/api/chat', aliceToken, { message: 'hello' })).status, 501);
  assert.equal(tokens.getBalance(alice), 20);
  assert.equal((await request('/api/terminal', aliceToken, { systemType: 'dev', command: 'node -e hello' })).status, 403);
  assert.equal(tokens.getBalance(alice), 20);
  assert.equal((await request('/api/terminal', aliceToken, { systemType: 'windows', command: 'dir' })).status, 200);
  assert.equal(tokens.getBalance(alice), 20);
  const worker = await extensions.spawnUserWorkspace(alice);
  await new Promise((resolve) => {
    worker.child.once('exit', resolve);
    worker.child.kill('SIGTERM');
  });
  assert.equal(db.prepare('SELECT port FROM tenant_workspaces WHERE user_id = ?').get(alice).port, null);
  const restored = await request('/api/workspace/file?path=file.txt', aliceToken);
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), { content: 'alice only' });
  assert.equal(tokens.getBalance(alice), 20);
  assert.equal(tokens.burnTokens(alice, 20), 0);
  assert.equal((await request('/api/chat', aliceToken, { message: 'hello' })).status, 402);
  assert.throws(() => tokens.burnTokens(alice, 1), { status: 402 });
});
