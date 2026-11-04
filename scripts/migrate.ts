import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error(
    "Set MIGRATION_DATABASE_URL to the Polli schema owner connection.",
  );
const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  await db.connect();
  await db.query(
    await readFile(
      new URL("../migrations/001_polli.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log("Brownbag schema ready.");
} finally {
  await db.end();
}
