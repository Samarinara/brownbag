// Local-only UI fixture. Never imported by production entrypoints.
// Run after npm run build: npx tsx tests/support/preview.ts
import { PGlite } from '@electric-sql/pglite';
import { TID } from '@atproto/common-web';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import { NetworkStore } from '../../server/network-store.js';
import { createNetworkApp } from '../../server/network-app.js';
import { createRecipeRecord } from '../../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../../shared/atproto.js';
import type { Database } from '../../server/db.js';
import { PlannerStore } from '../../server/planner.js';
import { addDays, localDate, weekStart } from '../../shared/planner.js';

const previewPort = Number(process.env.BROWNBAG_PREVIEW_PORT || 3001);
const previewOrigin = `http://127.0.0.1:${previewPort}`;
const pg = new PGlite();
await pg.exec(await readFile(new URL('../../migrations/001_network.sql', import.meta.url), 'utf8'));
const adapt = (p: any): Database => ({
  query: async (sql, params = []) => (await p.query(sql, params)).rows,
  transaction: (fn) => p.transaction((tx: any) => fn(adapt(tx))),
});
await pg.exec(
  await readFile(new URL('../../migrations/003_cookbook.sql', import.meta.url), 'utf8'),
);
const store = new NetworkStore(adapt(pg));
await pg.exec(
  await readFile(new URL('../../migrations/004_meal_planner.sql', import.meta.url), 'utf8'),
);
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const cid = 'bafyre' + 'a'.repeat(53);
const records = new Map<string, unknown>();
const input = {
  title: 'Sunday lemon pasta',
  summary: 'Bright, buttery, and ready before the table is set.',
  ingredients: [
    { name: 'spaghetti', quantity: '250', unit: 'g' },
    { name: 'lemon', quantity: '1' },
  ],
  instructions: [{ text: 'Cook pasta in salted water.' }, { text: 'Toss with lemon and serve.' }],
  cookMinutes: 15,
  tags: ['Weeknight favourites'],
};
const record = createRecipeRecord(input);
records.set('3mabc234567ab', record);
await store.actor(did, 'test-cook.example');
await store.index({
  did,
  collection: RECIPE_COLLECTION,
  rkey: '3mabc234567ab',
  cid,
  record,
  rev: TID.nextStr(),
});
// Relative dates keep the local demo useful without writing to a real account.
const demoPlanner = new PlannerStore(store);
const demoWeek = weekStart(localDate());
const demoRecipes = [
  { title: 'Slow Sunday pancakes', cookMinutes: 20, slot: 'breakfast' as const, day: 0 },
  { title: 'Roasted tomato sauce', cookMinutes: 35, slot: 'dinner' as const, day: 2 },
  { title: 'Crunchy chickpea salad', cookMinutes: 10, slot: 'lunch' as const, day: 4 },
  { title: 'Something sweet', cookMinutes: undefined, slot: 'other' as const, day: 6 },
];
for (const [index, demo] of demoRecipes.entries()) {
  const rkey = `demo${index}`;
  const demoRecord = createRecipeRecord({
    ...input,
    title: demo.title,
    cookMinutes: demo.cookMinutes,
  });
  records.set(rkey, demoRecord);
  await store.index({
    did,
    collection: RECIPE_COLLECTION,
    rkey,
    cid,
    record: demoRecord,
    rev: TID.nextStr(),
  });
  await demoPlanner.add(did, {
    id: randomUUID(),
    uri: `at://${did}/${RECIPE_COLLECTION}/${rkey}`,
    date: addDays(demoWeek, demo.day),
    slot: demo.slot,
    note: index === 1 ? 'Make extra for the freezer.' : '',
  });
}
await demoPlanner.add(did, {
  id: randomUUID(),
  uri: `at://${did}/${RECIPE_COLLECTION}/3mabc234567ab`,
  date: addDays(demoWeek, 2),
  slot: 'dinner',
  note: 'Serve the sauce on the side.',
});
await store.db.query(
  "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
  [createHash('sha256').update('local-preview-only').digest('hex'), did],
);
const photos = new Map<string, { bytes: Uint8Array; type: string }>();
const agent = {
  uploadBlob: async (bytes: Uint8Array, options: { encoding: string }) => {
    const cid = 'bafkrei' + 'a'.repeat(52);
    photos.set(cid, { bytes, type: options.encoding });
    return {
      data: {
        blob: {
          $type: 'blob',
          ref: { $link: cid },
          mimeType: options.encoding,
          size: bytes.length,
        },
      },
    };
  },
  com: {
    atproto: {
      sync: {
        getBlob: async ({ cid }: { cid: string }) => {
          const photo = photos.get(cid);
          if (!photo) throw new Error('Photo not found');
          return { data: photo.bytes, headers: { 'content-type': photo.type } };
        },
      },
      repo: {
        getRecord: async ({ rkey }: any) => ({ data: { cid, value: records.get(rkey) } }),
        putRecord: async ({ rkey, record }: any) => {
          records.set(rkey, record);
          return {
            data: {
              uri: `at://${did}/${RECIPE_COLLECTION}/${rkey}`,
              cid,
              commit: { rev: TID.nextStr() },
            },
          };
        },
        deleteRecord: async ({ rkey }: any) => {
          records.delete(rkey);
          return { data: { commit: { rev: TID.nextStr() } } };
        },
      },
    },
  },
};
const app = express();
app.use((_req, res, next) => {
  res.cookie('brownbag_session', 'local-preview-only', { httpOnly: true, sameSite: 'lax' });
  next();
});
// Serve only the in-memory mock photos; production resolves the real account's PDS.
app.get('/api/recipe-image', async (req, res) => {
  const recipe = await store.recipe(String(req.query.uri));
  const ref = recipe.record.images?.[Number(req.query.index)]?.image.ref.$link;
  const photo = ref && photos.get(ref);
  if (!photo) {
    res.sendStatus(404);
    return;
  }
  res.type(photo.type).send(Buffer.from(photo.bytes));
});
app.use(
  createNetworkApp({
    origin: previewOrigin,
    store,
    oauth: { agent: async () => agent } as any,
  }),
);
app.use(express.static(resolve('dist/client')));
app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: resolve('dist/client') }));
app.listen(previewPort, '127.0.0.1', () =>
  console.info(`Local mock-account preview: ${previewOrigin}`),
);
