const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createUserModel } = require('../models/User');
const { createAuthService } = require('../services/authService');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    is_genesis INTEGER NOT NULL DEFAULT 0,
    is_registered INTEGER NOT NULL DEFAULT 1,
    genesis_locked INTEGER NOT NULL DEFAULT 0,
    token_balance INTEGER NOT NULL DEFAULT 0
  )`);
  db.prepare(`INSERT INTO users (username, is_genesis, is_registered, genesis_locked)
    VALUES ('RFOF-NETWORK', 1, 0, 0)`).run();
  return {
    db,
    service: createAuthService({
      users: createUserModel(db),
      db,
      genesisPassword: 'a-secure-genesis-password',
      jwtSecret: 'a-jwt-secret-that-is-long-enough-for-tests',
    }),
  };
}

test('Genesis account requires the secret and can be claimed only once', async () => {
  const { db, service } = fixture();
  await assert.rejects(service.register('RFOF-NETWORK', 'long-user-password', 'wrong-secret'), { status: 403 });
  await assert.rejects(service.register('rfof-network', 'long-user-password'), { status: 409 });
  const user = await service.register('RFOF-NETWORK', 'long-user-password', 'a-secure-genesis-password');
  assert.equal(user.is_registered, 1);
  assert.equal(user.genesis_locked, 1);
  await assert.rejects(service.register('RFOF-NETWORK', 'another-long-password', 'a-secure-genesis-password'), { status: 409 });
  db.close();
});

test('regular users can register and receive a short-lived authenticated session', async () => {
  const { db, service } = fixture();
  await service.register('test-user', 'long-user-password');
  const session = await service.login('test-user', 'long-user-password');
  assert.equal(service.verifyToken(session.token).username, 'test-user');
  await assert.rejects(service.login('test-user', 'wrong-password'), { status: 401 });
  db.close();
});
