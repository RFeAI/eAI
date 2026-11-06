const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const MAX_ACTIVE_WORKERS = 8;
const STARTUP_TIMEOUT_MS = 10000;

function createExtensionService({ db, workspaceRoot, tokens }) {
  const workers = new Map();
  const pending = new Map();
  let closing = false;
  const get = db.prepare('SELECT user_id, port FROM tenant_workspaces WHERE user_id = ?');
  const save = db.prepare(`
    INSERT INTO tenant_workspaces (user_id, port) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET port = excluded.port
  `);
  const clearPort = db.prepare('UPDATE tenant_workspaces SET port = NULL WHERE user_id = ? AND port = ?');

  function validateUser(userId) {
    const id = String(userId);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw Object.assign(new Error('Invalid tenant identity.'), { status: 400 });
    }
    tokens.getBalance(id);
    return id;
  }

  async function spawnUserWorkspace(userId, { create = false } = {}) {
    const id = validateUser(userId);
    if (closing) throw Object.assign(new Error('Gateway is shutting down.'), { status: 503 });
    if (workers.has(id)) return { ...workers.get(id), created: false };
    if (pending.has(id)) {
      const worker = await pending.get(id);
      return { ...worker, created: false };
    }
    const existing = get.get(id);
    if (!existing && !create) return null;
    if (workers.size + pending.size >= MAX_ACTIVE_WORKERS) {
      throw Object.assign(new Error('Workspace capacity reached. Try again later.'), { status: 503 });
    }

    const startup = new Promise((resolve, reject) => {
      const secret = crypto.randomBytes(32).toString('hex');
      const child = fork(path.join(__dirname, '..', 'workers', 'tenantWorker.js'), [], {
        env: { PATH: process.env.PATH || '' },
        execArgv: [],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Workspace startup timed out.')), STARTUP_TIMEOUT_MS);
      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(Object.assign(error, { status: 503 }));
      }
      child.once('error', fail);
      child.once('exit', (code, signal) => {
        if (!settled) return fail(new Error(`Workspace exited during startup (${signal || code}).`));
        const current = workers.get(id);
        if (current?.child === child) {
          workers.delete(id);
          try { clearPort.run(id, current.port); } catch (error) { console.error('Failed to clear tenant port:', error); }
        }
      });
      child.on('message', (message) => {
        if (settled || message?.type !== 'ready') return;
        const port = message.port;
        if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(new Error('Worker returned an invalid port.'));
        try {
          db.exec('BEGIN IMMEDIATE');
          save.run(id, port);
          if (!existing) tokens.mintTokens(id, 'extension');
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch (rollbackError) { console.error('Workspace transaction rollback failed:', rollbackError); }
          return fail(error);
        }
        settled = true;
        clearTimeout(timer);
        const worker = { child, port, secret, created: !existing };
        workers.set(id, worker);
        resolve(worker);
      });
      child.send({ userId: id, workspaceRoot, secret }, (error) => {
        if (error) fail(error);
      });
    });
    pending.set(id, startup);
    try {
      return await startup;
    } finally {
      pending.delete(id);
    }
  }

  function hasWorkspace(userId) {
    return Boolean(get.get(validateUser(userId)));
  }

  async function close() {
    closing = true;
    await Promise.allSettled([...pending.values()]);
    const active = [...workers.values()];
    await Promise.all(active.map(({ child }) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    })));
  }

  return { spawnUserWorkspace, hasWorkspace, close };
}

module.exports = { createExtensionService };
