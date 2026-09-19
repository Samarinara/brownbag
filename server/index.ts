import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { initializeApp } from './runtime.js';

const app = await initializeApp();
const server = createServer(app);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist/client'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: resolve('dist/client') }));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'custom',
  });
  app.use(vite.middlewares);
  app.get('/{*path}', async (req, res) =>
    res
      .type('html')
      .send(
        await vite.transformIndexHtml(
          req.originalUrl,
          await readFile(resolve('index.html'), 'utf8'),
        ),
      ),
  );
}
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
  console.info(`Brownbag ready at ${process.env.APP_ORIGIN || 'http://127.0.0.1:3000'}`),
);
