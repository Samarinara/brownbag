import 'dotenv/config';
import { connectDatabase } from './db.js';
import { pruneMealPlans } from './planner.js';
const { db, sql } = connectDatabase();
try {
  await pruneMealPlans(db);
  console.info('Expired meal plans deleted.');
} finally {
  await sql.end();
}
