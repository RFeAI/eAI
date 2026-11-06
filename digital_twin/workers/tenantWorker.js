const crypto = require('node:crypto');
const express = require('express');
const { createWorkspaceService } = require('../services/workspaceService');
const { createRouterService } = require('../services/routerService');

process.once('message', ({ userId, workspaceRoot, secret }) => {
  const app = express();
  const workspace = createWorkspaceService({ workspaceRoot });
  const router = createRouterService({ workspaceRoot });
  const expected = Buffer.from(secret, 'hex');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const value = req.get('x-eai-worker-key') || '';
    const supplied = Buffer.from(value, 'hex');
    if (!/^[a-f0-9]{64}$/.test(value) || supplied.length !== expected.length ||
        !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.get('/api/workspace/tree', async (req, res, next) => {
    try { res.json({ entries: await workspace.list(userId, req.query.path || '') }); } catch (error) { next(error); }
  });
  app.get('/api/workspace/file', async (req, res, next) => {
    try { res.json({ content: await workspace.read(userId, req.query.path) }); } catch (error) { next(error); }
  });
  app.post('/api/workspace/file', async (req, res, next) => {
    try {
      await workspace.write(userId, req.body?.path, req.body?.content);
      res.json({ saved: true });
    } catch (error) { next(error); }
  });
  app.post('/api/workspace/folder', async (req, res, next) => {
    try { await workspace.createFolder(userId, req.body?.path); res.status(201).json({ created: true }); } catch (error) { next(error); }
  });
  app.post('/api/workspace/delete', async (req, res, next) => {
    try { await workspace.remove(userId, req.body?.path); res.json({ deleted: true }); } catch (error) { next(error); }
  });
  app.post('/api/terminal', async (req, res, next) => {
    try {
      const { systemType, command } = req.body || {};
      res.json({ output: await router.routeCommand(userId, systemType, command) });
    } catch (error) { next(error); }
  });
  app.use((error, _req, res, _next) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Tenant worker error:', error);
    return res.status(500).json({ error: 'Workspace operation failed.' });
  });
  const server = app.listen(0, '127.0.0.1', () => {
    if (process.send) process.send({ type: 'ready', port: server.address().port });
  });
  server.on('error', (error) => { console.error('Tenant worker startup failed:', error); process.exitCode = 1; });
  process.once('disconnect', () => server.close(() => process.exit(0)));
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
});
