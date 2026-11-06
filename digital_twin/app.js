const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createUserModel } = require('./models/User');
const { createAuthService, publicUser } = require('./services/authService');
const { createRouterService } = require('./services/routerService');
const { createWorkspaceService } = require('./services/workspaceService');

function createApp({ db, config }) {
  const app = express();
  const users = createUserModel(db);
  const auth = createAuthService({
    users,
    db,
    genesisPassword: process.env.GENESIS_ADMIN_PASSWORD,
    jwtSecret: process.env.JWT_SECRET,
  });
  const router = createRouterService({ workspaceRoot: config.workspaceRoot });
  const workspace = createWorkspaceService({ workspaceRoot: config.workspaceRoot });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: config.publicUiOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '2mb', strict: true }));

  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/register', authLimit, async (req, res, next) => {
    try {
      const { username, password, genesisPassword } = req.body || {};
      const user = await auth.register(username, password, genesisPassword);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/auth/login', authLimit, async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      res.json(await auth.login(username, password));
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (req, res, next) => {
    const match = req.get('authorization')?.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: 'Authentication required.' });
    try {
      req.identity = auth.verifyToken(match[1]);
      return next();
    } catch {
      return res.status(401).json({ error: 'Session is invalid or expired.' });
    }
  });
  app.get('/api/account', (req, res) => {
    const user = users.findByUsername(req.identity.username);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    return res.json({ user: publicUser(user) });
  });
  const workspaceLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  const terminalLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/api/workspace/tree', workspaceLimit, async (req, res, next) => {
    try {
      res.json({ entries: await workspace.list(req.identity.sub, req.query.path || '') });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/workspace/file', workspaceLimit, async (req, res, next) => {
    try {
      res.json({ content: await workspace.read(req.identity.sub, req.query.path) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/workspace/file', workspaceLimit, async (req, res, next) => {
    try {
      const { path: relativePath, content } = req.body || {};
      await workspace.write(req.identity.sub, relativePath, content);
      res.json({ saved: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/workspace/folder', workspaceLimit, async (req, res, next) => {
    try {
      await workspace.createFolder(req.identity.sub, req.body?.path);
      res.status(201).json({ created: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/workspace/delete', workspaceLimit, async (req, res, next) => {
    try {
      await workspace.remove(req.identity.sub, req.body?.path);
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/terminal', terminalLimit, async (req, res, next) => {
    try {
      const { systemType, command } = req.body || {};
      res.json({ output: await router.routeCommand(req.identity.sub, systemType, command) });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

module.exports = { createApp };
