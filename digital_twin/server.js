const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { loadConfig } = require('./config/db.config');
const { createApp } = require('./app');
const { createExtensionService } = require('./services/extensionService');
const { createTokenService } = require('./services/tokenService');

function prepareDatabase(config) {
  const databaseFile = config.dbPath;
  fs.mkdirSync(config.vaultDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(databaseFile) && config.backupPath) {
    if (!fs.existsSync(config.backupPath)) throw new Error(`Configured database backup is missing: ${config.backupPath}`);
    fs.copyFileSync(config.backupPath, databaseFile, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(databaseFile, 0o600);
    const restored = new DatabaseSync(databaseFile);
    const check = restored.prepare('PRAGMA integrity_check').get().integrity_check;
    restored.close();
    if (check !== 'ok') {
      fs.unlinkSync(databaseFile);
      throw new Error(`Database backup failed integrity_check: ${check}`);
    }
  }

  const db = new DatabaseSync(databaseFile);
  fs.chmodSync(databaseFile, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      is_genesis INTEGER NOT NULL DEFAULT 0,
      is_registered INTEGER NOT NULL DEFAULT 1,
      genesis_locked INTEGER NOT NULL DEFAULT 0,
      token_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenant_workspaces (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      port INTEGER
    );
    UPDATE tenant_workspaces SET port = NULL;
  `);
  db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, is_genesis, is_registered, genesis_locked, token_balance)
    VALUES (?, '', 1, 0, 0, 0)
  `).run('RFOF-NETWORK');
  return db;
}

function start() {
  const config = loadConfig();
  const db = prepareDatabase(config);
  const tokens = createTokenService(db);
  const extensions = createExtensionService({ db, workspaceRoot: config.workspaceRoot, tokens });
  const app = createApp({ db, config, tokens, extensions });
  const server = app.listen(config.port, config.host, () => {
    console.log(`eAI private broker listening on ${config.host}:${config.port}`);
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      try {
        await extensions.close();
        db.close();
      } catch (error) {
        console.error('Shutdown failed:', error);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { app, server, db };
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { prepareDatabase, start };
