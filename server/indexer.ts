import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { connectDatabase } from './db.js';
import { ingestEvent, jetstreamUrl, persistCursor } from './atproto/ingestion.js';

export async function runIndexer(signal: AbortSignal) {
  const { db, sql } = connectDatabase();
  const source = process.env.JETSTREAM_URL || 'wss://jetstream2.us-east.bsky.network/subscribe';
  const overlap = Number(process.env.JETSTREAM_REPLAY_OVERLAP_US || 5_000_000);
  if (!Number.isSafeInteger(overlap) || overlap < 0)
    throw new Error('Invalid JETSTREAM_REPLAY_OVERLAP_US');
  let delay = 1000;
  try {
    while (!signal.aborted) {
      try {
        const known = new Set(
          (await db.query('SELECT did FROM actors')).map((row) => String(row.did)),
        );
        const [saved] = await db.query('SELECT cursor FROM sync_cursors WHERE source=$1', [source]);
        const initial = saved ? Number(saved.cursor) : Date.now() * 1000;
        let cursor = initial;
        let checkpointAt = Date.now();
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(jetstreamUrl(source, initial, overlap), {
            maxPayload: 2 * 1024 * 1024,
            handshakeTimeout: 15000,
          });
          let pending = Promise.resolve();
          let queued = 0;
          let queuedBytes = 0;
          let failed = false;
          let lastPong = Date.now();
          const heartbeat = setInterval(() => {
            if (Date.now() - lastPong > 90000) socket.terminate();
            else if (socket.readyState === WebSocket.OPEN) socket.ping();
          }, 30000);
          const stop = () => socket.terminate();
          signal.addEventListener('abort', stop, { once: true });
          socket.on('pong', () => {
            lastPong = Date.now();
          });
          socket.on('open', () => {
            console.log('Indexer connected');
          });
          socket.on('message', (raw) => {
            if (failed || signal.aborted) return;
            const bytes = Array.isArray(raw)
              ? raw.reduce((sum, chunk) => sum + chunk.length, 0)
              : raw.byteLength;
            if (queued >= 1000 || queuedBytes + bytes > 8 * 1024 * 1024) {
              failed = true;
              socket.terminate();
              return;
            }
            queued++;
            queuedBytes += bytes;
            pending = pending
              .then(async () => {
                // Queued messages preceding an overflow are still safe to process in order.
                let value: unknown;
                try {
                  value = JSON.parse(raw.toString());
                } catch {
                  value = { malformed: raw.toString().slice(0, 4000) };
                }
                const result = await ingestEvent(db, value, source, known);
                if (result.cursor !== undefined) cursor = Math.max(cursor, result.cursor);
                // No database heartbeat; sparse global identity traffic checkpoints at most every ten minutes.
                if (result.applied || Date.now() - checkpointAt >= 600000) {
                  await persistCursor(db, source, cursor);
                  checkpointAt = Date.now();
                }
                delay = 1000;
              })
              .finally(() => {
                queued--;
                queuedBytes -= bytes;
              });
            void pending.catch(() => {
              failed = true;
              socket.terminate();
            });
          });
          socket.on('error', () => {
            socket.terminate();
          });
          socket.on('close', () => {
            clearInterval(heartbeat);
            signal.removeEventListener('abort', stop);
            void pending
              .then(async () => {
                if (cursor > initial) await persistCursor(db, source, cursor);
              })
              .then(resolve, reject);
          });
        });
      } catch (error) {
        console.error(
          'Indexer disconnected; retrying from durable cursor:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
      if (!signal.aborted)
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, delay + Math.floor(Math.random() * 250));
          signal.addEventListener('abort', finish, { once: true });
        });
      delay = Math.min(delay * 2, 30000);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  runIndexer(controller.signal).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
