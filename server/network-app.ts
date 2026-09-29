import { cookbookTagsSchema, defaultCookbookTags } from '../shared/atproto.js';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import helmet from 'helmet';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  didSchema,
  recipeInputSchema,
  draftInputSchema,
  strongRefSchema,
} from '../shared/atproto.js';
import { reconcileRepository } from './atproto/reconcile.js';
import type { OAuthService } from './atproto/oauth.js';
import { HttpError, NetworkStore } from './network-store.js';
import { Publisher } from './publishing.js';
import { mountNetworkMcp } from './network-mcp.js';
import { mountPlanner } from './planner.js';

const fetchPhoto = safeFetchWrap({ responseMaxSize: 5_000_000, timeout: 15_000 });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function createNetworkApp(config: {
  origin: string;
  store?: NetworkStore;
  oauth?: OAuthService;
  missing?: string[];
}) {
  const app = express();
  const localDevelopment =
    process.env.NODE_ENV !== 'production' && !config.origin.startsWith('https:');
  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', 1);
  else if (process.env.TRUST_PROXY_HOPS)
    app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: localDevelopment ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: localDevelopment ? ["'self'", 'ws:'] : ["'self'"],
          upgradeInsecureRequests: config.origin.startsWith('https:') ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser());
  const cookie = {
    httpOnly: true,
    secure: config.origin.startsWith('https:'),
    sameSite: 'lax' as const,
    path: '/',
  };
  app.use(['/api', '/mcp'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // OAuth navigation callbacks are cross-site GETs; all mutations remain same-origin.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      ((req.headers.origin && req.headers.origin !== config.origin) ||
        req.headers['sec-fetch-site'] === 'cross-site')
    )
      return next(new HttpError(403, 'Request origin is not allowed.'));
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/config', (_req, res) =>
    res.json({ configured: !!config.store && !!config.oauth, missing: config.missing || [] }),
  );
  app.get('/health', async (_req, res) => {
    if (!config.store) {
      res.status(503).json({ status: 'unconfigured' });
      return;
    }
    await config.store.db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.get('/oauth-client-metadata.json', (_req, res) => {
    if (!config.oauth) throw new HttpError(503, 'Sign-in is not configured yet.');
    res.json(config.oauth.clientMetadata);
  });
  app.get('/jwks.json', (_req, res) => res.json(config.oauth?.jwks || { keys: [] }));
  const requireServices: RequestHandler = (_req, _res, next) => {
    if (!config.store || !config.oauth)
      return next(new HttpError(503, 'Brownbag is being set up. Please come back soon.'));
    next();
  };
  app.use(['/api', '/mcp'], requireServices);
  const store = config.store!;
  const oauth = config.oauth!;
  const publisher = store && oauth ? new Publisher(store, (did) => oauth.agent(did)) : undefined!;
  const identify: RequestHandler = async (req, res, next) => {
    const token = req.cookies?.brownbag_session;
    if (typeof token === 'string') {
      const [user] = await store.db.query(
        'SELECT s.did,a.handle FROM app_sessions s JOIN actors a ON a.did=s.did WHERE s.hash=$1 AND s.expires_at>now() AND a.active',
        [digest(token)],
      );
      if (user) res.locals.user = user;
    }
    next();
  };
  const requireUser: RequestHandler = (_req, res, next) =>
    res.locals.user ? next() : next(new HttpError(401, 'Sign in to continue.'));
  app.use('/api', identify);
  app.post('/api/auth/login', async (req, res) => {
    await store.rateLimit(`login:${req.ip}`, 15, 900);
    const { handle } = z
      .object({
        handle: z
          .string()
          .trim()
          .min(1)
          .max(253)
          .regex(/^@?[a-zA-Z0-9.-]+$/),
      })
      .strict()
      .parse(req.body);
    const nonce = randomBytes(32).toString('base64url');
    const url = await oauth.authorize(handle, nonce);
    res.cookie('brownbag_oauth', nonce, { ...cookie, maxAge: 900_000 }).json({ url: String(url) });
  });
  app.get('/api/auth/callback', async (req, res) => {
    const nonce = req.cookies?.brownbag_oauth;
    if (typeof nonce !== 'string') throw new HttpError(400, 'Sign-in expired. Please try again.');
    const result = await oauth.callback(new URL(req.originalUrl, config.origin).searchParams);
    if (
      typeof result.state !== 'string' ||
      result.state.length !== nonce.length ||
      !timingSafeEqual(Buffer.from(result.state), Buffer.from(nonce))
    )
      throw new HttpError(400, 'Sign-in could not be verified. Please try again.');
    const did = result.session.did;
    const identity = await oauth.identity(did);
    await store.actor(did, identity.handle === 'handle.invalid' ? undefined : identity.handle);
    const token = randomBytes(32).toString('base64url');
    await store.db.query(
      "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '30 days')",
      [digest(token), did],
    );
    res
      .clearCookie('brownbag_oauth', cookie)
      .cookie('brownbag_session', token, { ...cookie, maxAge: 30 * 86400_000 })
      .redirect('/');
  });
  app.post('/api/auth/logout', requireUser, async (req, res) => {
    await store.db.query('DELETE FROM app_sessions WHERE hash=$1', [
      digest(req.cookies.brownbag_session),
    ]);
    res.clearCookie('brownbag_session', cookie).json({ ok: true });
  });
  app.get('/api/me', requireUser, (_req, res) => res.json(res.locals.user));
  app.post('/api/sync', requireUser, async (_req, res) => {
    await store.rateLimit(`sync:${res.locals.user.did}`, 4, 3600);
    res.json(
      await reconcileRepository(
        store.db,
        await oauth.agent(res.locals.user.did),
        res.locals.user.did,
      ),
    );
  });
  app.get('/api/recipes', async (req, res) => {
    const options = z
      .object({
        q: z.string().max(200).default(''),
        feed: z.enum(['discover', 'following', 'mine', 'saved', 'cookbook']).default('discover'),
        limit: z.coerce.number().int().min(1).max(100).default(24),
        cursor: z.string().max(3000).optional(),
        tag: z.string().max(25).optional(),
      })
      .parse(req.query);
    if (options.feed === 'discover')
      res.set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    res.json(await store.recipes({ ...options, did: res.locals.user?.did }));
  });
  app.get('/api/recipe', async (req, res) => {
    const uri = z.string().max(3000).parse(req.query.uri);
    const recipe = await store.recipe(uri);
    res
      .set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60')
      .json(recipe);
  });
  app.get('/api/recipe-image', async (req, res) => {
    const { uri, index } = z
      .object({ uri: z.string().max(3000), index: z.coerce.number().int().min(0).max(7) })
      .parse(req.query);
    const recipe = await store.recipe(uri);
    const photo = recipe.record.images?.[index];
    if (!photo) throw new HttpError(404, 'Photo not found.');
    const identity = await oauth.identity(recipe.authorDid);
    const endpoint = identity.didDoc.service?.find(
      (service) =>
        (service.id === '#atproto_pds' || service.id === `${recipe.authorDid}#atproto_pds`) &&
        service.type === 'AtprotoPersonalDataServer',
    )?.serviceEndpoint;
    if (typeof endpoint !== 'string') throw new HttpError(404, 'Photo account not found.');
    const url = new URL('/xrpc/com.atproto.sync.getBlob', endpoint);
    url.search = new URLSearchParams({
      did: recipe.authorDid,
      cid: photo.image.ref.$link,
    }).toString();
    const response = await fetchPhoto(url, { redirect: 'error' });
    if (!response.ok) throw new HttpError(404, 'Photo is unavailable.');
    const mimeType = response.headers.get('content-type')?.split(';')[0];
    if (mimeType !== photo.image.mimeType) throw new HttpError(400, 'Unexpected photo format.');
    res.type(mimeType).send(Buffer.from(await response.arrayBuffer()));
  });
  app.get('/api/images/:cid', requireUser, async (req, res) => {
    const cid = recipeInputSchema.shape.images
      .unwrap()
      .element.shape.image.shape.ref.shape.$link.parse(req.params.cid);
    const agent = await oauth.agent(res.locals.user.did);
    const result = await agent.com.atproto.sync.getBlob({ did: res.locals.user.did, cid });
    const mimeType = result.headers['content-type']?.split(';')[0];
    if (
      !mimeType ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mimeType) ||
      result.data.length > 5_000_000
    )
      throw new HttpError(400, 'Unexpected photo format.');
    res.type(mimeType).send(Buffer.from(result.data));
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    if (!res.locals.user) return next(new HttpError(401, 'Sign in to continue.'));
    void store.rateLimit(`write:${res.locals.user.did}`, 60).then(() => next(), next);
  });
  app.post(
    '/api/images',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
      limit: 5_000_000,
    }),
    async (req, res) => {
      const mimeType = req.get('Content-Type')?.split(';')[0];
      if (
        !mimeType ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mimeType) ||
        !Buffer.isBuffer(req.body) ||
        !req.body.length
      )
        throw new HttpError(400, 'Choose a JPEG, PNG, WebP or AVIF photo up to 5 MB.');
      const agent = await oauth.agent(res.locals.user.did);
      const result = await agent.uploadBlob(req.body, { encoding: mimeType });
      const image = recipeInputSchema.shape.images
        .unwrap()
        .element.shape.image.parse(JSON.parse(JSON.stringify(result.data.blob)));
      res.status(201).json({ image });
    },
  );
  app.get('/api/drafts', requireUser, async (_req, res) =>
    res.json({ drafts: await store.drafts(res.locals.user.did) }),
  );
  app.post('/api/drafts', async (req, res) =>
    res
      .status(201)
      .json(
        await store.saveDraft(
          res.locals.user.did,
          z.object({ data: draftInputSchema }).strict().parse(req.body).data,
        ),
      ),
  );
  app.put('/api/drafts/:id', async (req, res) =>
    res.json(
      await store.saveDraft(
        res.locals.user.did,
        z.object({ data: draftInputSchema }).strict().parse(req.body).data,
        z.string().uuid().parse(req.params.id),
      ),
    ),
  );
  app.delete('/api/drafts/:id', async (req, res) => {
    await store.db.query('DELETE FROM drafts WHERE id=$1 AND did=$2', [
      z.string().uuid().parse(req.params.id),
      res.locals.user.did,
    ]);
    res.json({ ok: true });
  });
  app.post('/api/recipes', async (req, res) => {
    const { recipe, draftId } = z
      .object({ recipe: recipeInputSchema, draftId: z.string().uuid().optional() })
      .strict()
      .parse(req.body);
    if (draftId) {
      const own = await store.db.query('SELECT id FROM drafts WHERE id=$1 AND did=$2', [
        draftId,
        res.locals.user.did,
      ]);
      if (!own.length) throw new HttpError(404, 'Draft not found.');
    }
    const result = await publisher.publish(res.locals.user.did, recipe);
    if (draftId) {
      // A concurrently edited draft should never be silently discarded after publication.
      try {
        await store.db.query('DELETE FROM drafts WHERE id=$1 AND did=$2 AND data=$3::text::jsonb', [
          draftId,
          res.locals.user.did,
          JSON.stringify(recipe),
        ]);
      } catch {
        console.error('Published recipe; draft cleanup needs a retry.');
      }
    }
    res.status(201).json(result);
  });
  app.put('/api/recipe', async (req, res) => {
    const { uri, cid, recipe } = strongRefSchema
      .extend({ recipe: recipeInputSchema })
      .strict()
      .parse(req.body);
    res.json(await publisher.publish(res.locals.user.did, recipe, { uri, cid }));
  });
  app.delete('/api/recipe', async (req, res) => {
    const { uri, cid } = strongRefSchema.parse(req.body);
    await publisher.delete(res.locals.user.did, uri, cid);
    res.json({ ok: true });
  });
  app.get('/api/cookbook/tags', requireUser, async (_req, res) => {
    const rows = await store.db.query('SELECT name FROM cookbook_tags WHERE did=$1 ORDER BY name', [
      res.locals.user.did,
    ]);
    res
      .set('Cache-Control', 'private, no-store')
      .json({ tags: [...new Set([...defaultCookbookTags, ...rows.map((row) => row.name)])] });
  });
  app.get('/api/cookbook/entry', requireUser, async (req, res) => {
    res
      .set('Cache-Control', 'private, no-store')
      .json(
        await store.cookbookEntry(res.locals.user.did, z.string().max(3000).parse(req.query.uri)),
      );
  });
  app.post('/api/bookmarks', async (req, res) => {
    const { uri, tags } = z
      .object({ uri: z.string().max(3000), tags: cookbookTagsSchema.optional() })
      .strict()
      .parse(req.body);
    await store.saveCookbook(res.locals.user.did, uri, tags);
    res.json({ ok: true });
  });
  app.delete('/api/bookmarks', async (req, res) => {
    const { uri } = z
      .object({ uri: z.string().max(3000) })
      .strict()
      .parse(req.body);
    await store.removeCookbook(res.locals.user.did, uri);
    res.json({ ok: true });
  });
  for (const method of ['post', 'delete'] as const)
    app[method]('/api/follows', async (req, res) => {
      const { did } = z.object({ did: didSchema }).strict().parse(req.body);
      await publisher.follow(res.locals.user.did, did, method === 'delete');
      res.json({ ok: true });
    });
  mountPlanner(app, store, requireUser);
  mountNetworkMcp(app, store, publisher, requireUser);
  app.use(['/api', '/mcp'], (_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res
        .status(400)
        .json({ error: err.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      return;
    }
    const status =
      err instanceof HttpError
        ? err.status
        : err.error === 'InvalidSwap'
          ? 409
          : err.status === 413
            ? 413
            : 500;
    if (status === 500)
      console.error('Request failed:', err instanceof Error ? err.message : 'unknown error');
    res.status(status).json({
      error:
        status === 500
          ? 'Something went wrong. Please retry or sign in again.'
          : status === 409
            ? 'This recipe changed. Reload it before saving.'
            : err.message,
    });
  };
  app.use(errors);
  return app;
}
