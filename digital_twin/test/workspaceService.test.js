const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceService, MAX_FILE_BYTES } = require('../services/workspaceService');

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'eai-workspace-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const workspace = createWorkspaceService({ workspaceRoot: path.join(temp, 'workspaces') });
  return { temp, workspace };
}

test('workspace supports isolated text file and empty-folder operations', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.createFolder('42', 'src');
  await workspace.write('42', 'src/readme.txt', 'hello');

  assert.equal(await workspace.read('42', 'src/readme.txt'), 'hello');
  assert.deepEqual(await workspace.list('42', 'src'), [
    { name: 'readme.txt', path: 'src/readme.txt', type: 'file' },
  ]);
  assert.deepEqual(await workspace.list('43'), []);
  await workspace.remove('42', 'src/readme.txt');
  await workspace.remove('42', 'src');
  assert.deepEqual(await workspace.list('42'), []);
});

test('workspace rejects traversal, secret paths, symlinks, and oversized files', async (t) => {
  const { temp, workspace } = await fixture(t);
  await assert.rejects(workspace.read('42', '../outside'), { status: 400 });
  await assert.rejects(workspace.write('42', '.env', 'secret'), { status: 403 });
  await assert.rejects(workspace.write('42', 'nested/file.txt', 'missing parent'), { status: 404 });
  await assert.rejects(workspace.write('42', 'large.txt', 'x'.repeat(MAX_FILE_BYTES + 1)), { status: 413 });

  const outside = path.join(temp, 'outside.txt');
  await fs.writeFile(outside, 'outside');
  await fs.symlink(outside, path.join(temp, 'workspaces', '42', 'linked.txt'));
  await assert.rejects(workspace.read('42', 'linked.txt'), { status: 403 });
  await assert.rejects(workspace.write('42', 'linked.txt', 'overwrite'), { status: 403 });
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
});

test('workspace refuses recursive deletion of non-empty directories', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.createFolder('42', 'folder');
  await workspace.write('42', 'folder/file.txt', 'keep');
  await assert.rejects(workspace.remove('42', 'folder'), { code: 'ENOTEMPTY' });
  assert.equal(await workspace.read('42', 'folder/file.txt'), 'keep');
});
