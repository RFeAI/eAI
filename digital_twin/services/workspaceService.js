const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LIST_ENTRIES = 200;
const FORBIDDEN_NAMES = new Set(['.git', 'vault', 'node_modules']);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function parseRelativePath(value, allowRoot = false) {
  if (value === '' && allowRoot) return [];
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/')
  ) {
    fail(400, 'Invalid workspace path.');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.length > 128 || part.includes(':'))) {
    fail(400, 'Invalid workspace path.');
  }
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (
      FORBIDDEN_NAMES.has(lower) ||
      /(^|\.)(env|sqlite|sqlite-|db|pem|key|p12|pfx)(\.|$|-)/i.test(part) ||
      lower === '.env'
    ) {
      fail(403, 'This filename is reserved and cannot be accessed through the workspace API.');
    }
  }
  return parts;
}

function createWorkspaceService({ workspaceRoot }) {
  async function getBase(userId) {
    if (!/^\d+$/.test(String(userId))) fail(400, 'Workspace identity is invalid.');
    const root = path.resolve(workspaceRoot);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail(403, 'Workspace root is unavailable.');
    const rootReal = await fs.realpath(root);
    const base = path.join(rootReal, String(userId));
    if (!base.startsWith(`${rootReal}${path.sep}`)) fail(400, 'Workspace path is invalid.');
    await fs.mkdir(base, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const baseStat = await fs.lstat(base);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) fail(403, 'Workspace is not a regular directory.');
    return { base, rootReal };
  }

  async function inspectPath(base, parts, { allowMissing = false } = {}) {
    let current = base;
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (error.code === 'ENOENT' && allowMissing) return { target: current, stat: null };
        if (error.code === 'ENOENT') fail(404, 'Workspace path not found.');
        throw error;
      }
      if (stat.isSymbolicLink()) fail(403, 'Symbolic links are not allowed in workspace paths.');
      if (index < parts.length - 1 && !stat.isDirectory()) fail(400, 'Parent path is not a directory.');
    }
    return { target: current, stat: parts.length ? await fs.lstat(current) : await fs.lstat(base) };
  }

  async function list(userId, relativePath = '') {
    const parts = parseRelativePath(relativePath, true);
    const { base } = await getBase(userId);
    const { target, stat } = await inspectPath(base, parts);
    if (!stat.isDirectory()) fail(400, 'Requested workspace path is not a directory.');
    const entries = await fs.readdir(target, { withFileTypes: true });
    if (entries.length > MAX_LIST_ENTRIES) fail(413, `Folder exceeds the ${MAX_LIST_ENTRIES}-entry limit.`);
    return entries
      .filter((entry) => !entry.isSymbolicLink() && !isForbiddenName(entry.name))
      .map((entry) => ({
        name: entry.name,
        path: [...parts, entry.name].join('/'),
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported',
      }))
      .sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
  }

  async function read(userId, relativePath) {
    const parts = parseRelativePath(relativePath);
    const { base } = await getBase(userId);
    const { target, stat } = await inspectPath(base, parts);
    if (!stat.isFile() || stat.nlink > 1) fail(400, 'Only regular, unlinked text files can be opened.');
    if (stat.size > MAX_FILE_BYTES) fail(413, 'File exceeds the 1 MiB editor limit.');
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const currentStat = await handle.stat();
      if (!currentStat.isFile() || currentStat.nlink > 1 || currentStat.size > MAX_FILE_BYTES) {
        fail(400, 'File is not eligible for text editing.');
      }
      const buffer = await handle.readFile();
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        fail(415, 'Binary or invalid UTF-8 files cannot be opened in the text editor.');
      }
    } finally {
      await handle.close();
    }
  }

  async function write(userId, relativePath, content) {
    const parts = parseRelativePath(relativePath);
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      fail(413, 'File content must be text no larger than 1 MiB.');
    }
    const { base } = await getBase(userId);
    const parent = await inspectPath(base, parts.slice(0, -1));
    if (!parent.stat.isDirectory()) fail(400, 'Parent path is not a directory.');
    const { target, stat } = await inspectPath(base, parts, { allowMissing: true });
    if (stat && (!stat.isFile() || stat.nlink > 1)) fail(400, 'Only regular, unlinked files can be edited.');
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const currentStat = await handle.stat();
      if (!currentStat.isFile() || currentStat.nlink > 1) fail(400, 'Target is not a regular file.');
      await handle.truncate(0);
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
  }

  async function createFolder(userId, relativePath) {
    const parts = parseRelativePath(relativePath);
    const { base } = await getBase(userId);
    const parent = await inspectPath(base, parts.slice(0, -1));
    if (!parent.stat.isDirectory()) fail(400, 'Parent path is not a directory.');
    try {
      await fs.mkdir(path.join(parent.target, parts.at(-1)), { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') fail(409, 'A file or folder already exists at that path.');
      throw error;
    }
  }

  async function remove(userId, relativePath) {
    const parts = parseRelativePath(relativePath);
    const { base } = await getBase(userId);
    const { target, stat } = await inspectPath(base, parts);
    if (stat.isSymbolicLink()) fail(403, 'Symbolic links cannot be deleted through the workspace API.');
    if (stat.isDirectory()) {
      await fs.rmdir(target);
    } else if (stat.isFile()) {
      await fs.unlink(target);
    } else {
      fail(400, 'Only regular files and empty folders can be deleted.');
    }
  }

  return { list, read, write, createFolder, remove };
}

function isForbiddenName(name) {
  const lower = name.toLowerCase();
  return FORBIDDEN_NAMES.has(lower) ||
    /(^|\.)(env|sqlite|sqlite-|db|pem|key|p12|pfx)(\.|$|-)/i.test(name) ||
    lower === '.env';
}

module.exports = { createWorkspaceService, MAX_FILE_BYTES };
