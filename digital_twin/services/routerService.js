const path = require('node:path');
const fs = require('node:fs');
const { validateCommand } = require('../utils/commandWhitelist');
const { runReadOnly } = require('./connectors/linuxConnector');
const { unsupportedNotice } = require('./connectors/windowsConnector');

function createRouterService({ workspaceRoot }) {
  async function routeCommand(userId, systemType, command) {
    if (systemType === 'windows') return unsupportedNotice();
    const invocation = validateCommand(systemType, command);
    if (!invocation) throw Object.assign(new Error('Command is not on the read-only allowlist.'), { status: 403 });

    const root = path.resolve(workspaceRoot);
    if (!/^\d+$/.test(String(userId))) {
      throw Object.assign(new Error('Workspace path is invalid.'), { status: 400 });
    }
    const cwd = path.resolve(root, String(userId));
    if (!cwd.startsWith(`${root}${path.sep}`)) {
      throw Object.assign(new Error('Workspace path is invalid.'), { status: 400 });
    }
    fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
    return runReadOnly(invocation.executable, invocation.args, cwd);
  }

  return { routeCommand };
}

module.exports = { createRouterService };
