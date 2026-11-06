const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareDatabase } = require('../server');

test('database initialization reserves the unregistered Genesis account', () => {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eai-vault-'));
  const dbPath = path.join(vaultDir, 'system.sqlite');
  const db = prepareDatabase({ vaultDir, dbPath, backupPath: null });
  try {
    const genesis = db.prepare('SELECT username, is_genesis, is_registered, genesis_locked FROM users WHERE username = ?')
      .get('RFOF-NETWORK');
    assert.equal(genesis.username, 'RFOF-NETWORK');
    assert.equal(genesis.is_genesis, 1);
    assert.equal(genesis.is_registered, 0);
    assert.equal(genesis.genesis_locked, 0);
  } finally {
    db.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
