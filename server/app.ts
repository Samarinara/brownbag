import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomInt } from 'node:crypto';
import { z, ZodError } from 'zod';
import { Store, AppError } from './store.js';
import { setupAuth, type AuthConfig } from './auth.js';
import { mountMcp } from './mcp.js';

export function createApp(store: Store, config: AuthConfig) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
  app.use(
    helmet({
      contentSecurityPolicy: config.production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
      strictTransportSecurity: config.origin.startsWith('https:') ? undefined : false,
    }),
  );
  app.use(['/api', '/mcp'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.origin).origin)
      return next(new AppError(403, 'Request origin is not allowed.'));
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return next(new AppError(403, 'Cross-site requests are not allowed.'));
    next();
  });
  app.use(express.json({ limit: '512kb' }));
  app.use(cookieParser());
  app.get('/health', (_req, res) => {
    store.db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });
  app.use(
    ['/api', '/mcp'],
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a minute.' },
    }),
  );
  const { session, apiKey } = setupAuth(app, store, config);
  mountMcp(app, store, apiKey);
  app.use('/api', session);
  app.get('/api/recipes', (req, res) => {
    const { q, tag, mode, offset, limit } = z
      .object({
        q: z.string().max(200).default(''),
        tag: z.string().max(50).default(''),
        mode: z.enum(['title', 'full']).default('full'),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(24),
      })
      .parse(req.query);
    const all = store.search(req.user.id, q, mode === 'title', tag);
    res.json({ total: all.length, recipes: all.slice(offset, offset + limit) });
  });
  app.get('/api/stats', (req, res) => {
    const all = store.search(req.user.id);
    res.json({
      recipes: all.length,
      tags: [...new Set(all.flatMap((r) => r.tags))].sort(),
      pending: store.pendingCount(req.user.id),
    });
  });
  app.get('/api/recipes/random', (req, res) => {
    const { q, tag } = z
      .object({ q: z.string().max(200).default(''), tag: z.string().max(50).default('') })
      .parse(req.query);
    const all = store.search(req.user.id, q, false, tag);
    if (!all.length)
      throw new AppError(404, 'No recipes to choose from yet. Add your first recipe.');
    res.json(all[randomInt(all.length)]);
  });
  app.get('/api/trash', (req, res) => res.json(store.trash(req.user.id)));
  app.get('/api/recipes/:id', (req, res) =>
    res.json(store.get(req.user.id, String(req.params.id))),
  );
  app.post('/api/changes', (req, res) =>
    res.status(201).json(store.mutate(req.user.id, req.body, 'human')),
  );
  app.get('/api/changes', (req, res) => res.json(store.changes(req.user.id)));
  app.post('/api/changes/:id/review', (req, res) => {
    const { approve } = z.object({ approve: z.boolean() }).strict().parse(req.body);
    res.json(store.review(req.user.id, String(req.params.id), approve));
  });
  app.get('/api/recipes/:id/history', (req, res) =>
    res.json(store.revisions(req.user.id, String(req.params.id))),
  );
  app.post('/api/recipes/:id/restore', (req, res) => {
    const { revisionId, baseVersion } = z
      .object({ revisionId: z.string(), baseVersion: z.number().int().positive() })
      .strict()
      .parse(req.body);
    res.json(store.restore(req.user.id, String(req.params.id), revisionId, baseVersion));
  });
  app.get('/api/audit', (req, res) => res.json(store.logs(req.user.id)));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    const status =
      error instanceof AppError
        ? error.status
        : error.status === 400 || error.status === 413
          ? error.status
          : 500;
    if (status === 500) console.error(error);
    res
      .status(status)
      .json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  };
  app.use(errors);
  return app;
}
