const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCommand } = require('../utils/commandWhitelist');

test('allows only exact read-only version commands', () => {
  assert.deepEqual(validateCommand('git', 'git --version'), {
    executable: 'git',
    args: ['--version'],
  });
  assert.deepEqual(validateCommand('dev', 'node --version'), {
    executable: 'node',
    args: ['--version'],
  });
});

test('rejects shell syntax, mutations, other systems, and malformed input', () => {
  for (const [system, command] of [
    ['git', 'git status --short'],
    ['git', 'git --version; rm -rf /'],
    ['git', 'git push'],
    ['cmd', 'dir'],
    ['dev', 'node --eval "process.exit()"'],
    ['dev', 'npm install'],
    ['git', 7],
  ]) {
    assert.equal(validateCommand(system, command), null);
  }
});
