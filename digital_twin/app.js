const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createUserModel } = require('./models/User');
const { createAuthService, publicUser } = require('./services/authService');
const { createRouterService } = require('./services/routerService');
const { createWorkspaceService } = require('./services/workspaceService');
const { createTokenService } = require('./services/tokenService');
const { createExtensionService } = require('./services/extensionService');
const { createTenantResolver } = require('./middlewares/tenantResolver');
const { validateCommand } = require('./utils/commandWhitelist');

function createApp({ db, config, tokens = createTokenService(db), extensions }) {
  const app = express();
  extensions ||= createExtensionService({ db, workspaceRoot: config.workspaceRoot, tokens });
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
    if (!user || String(user.id) !== req.identity.sub || !user.is_registered) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    return res.json({ user: publicUser(user) });
  });
  const workspaceLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  const terminalLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const extensionLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  const resolveTenant = createTenantResolver({ extensions, tokens });

  app.post('/api/extensions', extensionLimit, async (req, res, next) => {
    try {
      const result = await extensions.spawnUserWorkspace(req.identity.sub, { create: true });
      res.status(result.created ? 201 : 200).json({
        created: result.created,
        tokenBalance: tokens.getBalance(req.identity.sub),
      });
    } catch (error) { next(error); }
  });
  app.get('/api/extensions', (req, res, next) => {
    try { res.json({ active: extensions.hasWorkspace(req.identity.sub) }); } catch (error) { next(error); }
  });
  app.post('/api/chat', (req, res, next) => {
    try {
      if (tokens.getBalance(req.identity.sub) < 1) {
        return res.status(402).json({ error: 'Insufficient token balance.' });
      }
      return res.status(501).json({ error: 'LLM connector is not configured; no tokens were charged.' });
    } catch (error) { return next(error); }
  });
  app.use('/api/workspace', workspaceLimit);
  app.use('/api/terminal', terminalLimit, (req, _res, next) => {
    try { tokens.getBalance(req.identity.sub); next(); } catch (error) { next(error); }
  });
  app.use((req, res, next) => {
    const allowedRoutes = new Set([
      'GET /api/workspace/tree', 'GET /api/workspace/file',
      'POST /api/workspace/file', 'POST /api/workspace/folder',
      'POST /api/workspace/delete', 'POST /api/terminal',
    ]);
    if (allowedRoutes.has(`${req.method} ${req.path}`)) return resolveTenant(req, res, next);
    return next();
  });
  app.get('/api/workspace/tree', async (req, res, next) => {
    try {
      res.json({ entries: await workspace.list(req.identity.sub, req.query.path || '') });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/workspace/file', async (req, res, next) => {
    try {
      res.json({ content: await workspace.read(req.identity.sub, req.query.path) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/workspace/file', async (req, res, next) => {
    try {
      const { path: relativePath, content } = req.body || {};
      await workspace.write(req.identity.sub, relativePath, content);
      res.json({ saved: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/workspace/folder', async (req, res, next) => {
    try {
      await workspace.createFolder(req.identity.sub, req.body?.path);
      res.status(201).json({ created: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/workspace/delete', async (req, res, next) => {
    try {
      await workspace.remove(req.identity.sub, req.body?.path);
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/terminal', async (req, res, next) => {
    try {
      const { systemType, command } = req.body || {};
      const output = await router.routeCommand(req.identity.sub, systemType, command);
      const tokenBalance = validateCommand(systemType, command)
        ? tokens.mintTokens(req.identity.sub, 'terminal')
        : tokens.getBalance(req.identity.sub);
      res.json({ output, tokenBalance });
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
