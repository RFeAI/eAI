const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const { validateCommand } = require('../utils/commandWhitelist');

function createTenantResolver({ extensions, tokens }) {
  const proxy = createProxyMiddleware({
    target: 'http://127.0.0.1:1',
    router: (req) => `http://127.0.0.1:${req.tenant.port}`,
    selfHandleResponse: true,
    proxyTimeout: 15000,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader('authorization');
        proxyReq.removeHeader('cookie');
        proxyReq.setHeader('x-eai-worker-key', req.tenant.secret);
        fixRequestBody(proxyReq, req);
      },
      proxyRes: (proxyRes, req, res) => {
        const chunks = [];
        let size = 0;
        proxyRes.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            proxyRes.destroy();
            if (!res.headersSent) res.status(502).json({ error: 'Workspace response too large.' });
          } else chunks.push(chunk);
        });
        proxyRes.on('error', (error) => {
          console.error('Tenant response failed:', error);
          if (!res.headersSent) res.status(502).json({ error: 'Workspace response failed.' });
        });
        proxyRes.on('end', () => {
          if (res.headersSent) return;
          try {
            if (req.path === '/api/terminal' && proxyRes.statusCode === 200 &&
                validateCommand(req.body?.systemType, req.body?.command)) {
              tokens.mintTokens(req.identity.sub, 'terminal');
            }
            res.status(proxyRes.statusCode || 502);
            res.type(proxyRes.headers['content-type'] || 'application/json');
            res.send(Buffer.concat(chunks));
          } catch (error) {
            console.error('Token accounting failed:', error);
            res.status(500).json({ error: 'Token accounting failed.' });
          }
        });
      },
      error: (error, _req, res) => {
        console.error('Tenant proxy failed:', error);
        if (!res.headersSent) res.status(502).json({ error: 'Workspace unavailable.' });
      },
    },
  });

  return async function tenantResolver(req, res, next) {
    try {
      const worker = await extensions.spawnUserWorkspace(req.identity.sub);
      if (!worker) return next();
      req.tenant = worker;
      return proxy(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createTenantResolver };
