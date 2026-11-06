const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createUserModel } = require('./models/User');
const { createAuthService, publicUser } = require('./services/authService');
const { createRouterService } = require('./services/routerService');

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

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: config.publicUiOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '8kb', strict: true }));

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
  app.post('/api/terminal', async (req, res, next) => {
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
    console.error(error);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

module.exports = { createApp };
