import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connectDatabase } from './db.js';
import { indexerStatus } from './sync-jobs.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db, sql } = connectDatabase();
  try {
    console.log(JSON.stringify(await indexerStatus(db), null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
