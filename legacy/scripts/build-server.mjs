import { readdir } from 'node:fs/promises';
import { build } from 'esbuild';

const tasks = (await readdir(new URL('../server/', import.meta.url)))
  .filter((name) => name.endsWith('.task.ts'))
  .sort()
  .map((name) => `server/${name}`);
const common = { bundle: true, platform: 'node', format: 'esm', packages: 'external' };

await build({ ...common, entryPoints: ['server/index.ts'], outfile: 'dist/server.js' });
await build({
  ...common,
  entryPoints: ['server/indexer.ts', 'server/migrate.ts', 'server/prune-meal-plans.ts', ...tasks],
  outdir: 'dist',
});
