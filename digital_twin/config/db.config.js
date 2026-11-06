const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const vaultDir = path.resolve(__dirname, '..', 'vault');
const envPath = path.join(vaultDir, '.env');

function loadConfig() {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Required secrets file is missing: ${envPath}. Copy .env.example to the vault and fill it in.`);
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const required = [
    'MASTER_ENCRYPTION_KEY',
    'JWT_SECRET',
    'GITHUB_SERVICE_TOKEN',
    'LLM_API_KEY',
    'GENESIS_ADMIN_PASSWORD',
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing required settings in vault/.env: ${missing.join(', ')}`);
  if (Buffer.byteLength(process.env.MASTER_ENCRYPTION_KEY, 'utf8') < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must contain at least 32 bytes.');
  }
  if (Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  }
  if (process.env.GENESIS_ADMIN_PASSWORD.length < 16) {
    throw new Error('GENESIS_ADMIN_PASSWORD must contain at least 16 characters.');
  }

  const genesisUser = process.env.GENESIS_USER || 'RFOF-NETWORK';
  if (genesisUser !== 'RFOF-NETWORK') {
    throw new Error('GENESIS_USER is fixed to the reserved account RFOF-NETWORK.');
  }

  return {
    dbPath: path.join(vaultDir, 'system.sqlite'),
    vaultDir,
    port: Number.parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    publicUiOrigin: process.env.PUBLIC_UI_ORIGIN || 'http://localhost:8080',
    workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT || '/tmp/eai-workspaces'),
    backupPath: process.env.SYSTEM_DB_BACKUP_PATH
      ? path.resolve(process.env.SYSTEM_DB_BACKUP_PATH)
      : null,
    orgName: process.env.ORG_NAME || 'RFeAI',
    genesisUser,
  };
}

module.exports = { loadConfig };
