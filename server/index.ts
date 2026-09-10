import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { Store } from './store.js';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
if (production && !process.env.SMTP_HOST)
  throw new Error('SMTP_HOST is required in production. See .env.example.');
const store = new Store(process.env.DATABASE_PATH || './data/brownbag.sqlite');
const app = createApp(store, {
  origin,
  production,
  mailMode: process.env.SMTP_HOST ? 'smtp' : 'console',
});
if (production) {
  app.use(express.static(resolve('dist/client'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
  app.get('/{*path}', async (req, res, next) => {
    try {
      res
        .type('html')
        .send(
          await vite.transformIndexHtml(
            req.originalUrl,
            await readFile(resolve('index.html'), 'utf8'),
          ),
        );
    } catch (error) {
      next(error);
    }
  });
}
const server = app.listen(port, '0.0.0.0', () =>
  console.info(
    `brownbag is ready at ${origin}${production ? '' : '\nDevelopment mode: email codes appear in this terminal.'}`,
  ),
);
const shutdown = () => {
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
