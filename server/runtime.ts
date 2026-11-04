import { Pool } from "pg";
import { createApp } from "./app.js";
export async function initializeApp() {
  const databaseUrl = process.env.DATABASE_URL;
  const platformUrl = process.env.POLLI_PLATFORM_URL;
  if (!databaseUrl || !platformUrl)
    throw new Error(
      "Configure DATABASE_URL and POLLI_PLATFORM_URL for the Brownbag API.",
    );
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
  });
  try {
    const result = await pool.query(
      `SELECT r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'polli_app','member') AS app,pg_has_role(current_user,'polli_api','member') AS api,pg_has_role(current_user,'polli_worker','member') AS worker,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('platform','brownbag') AND pg_has_role(current_user,c.relowner,'member')) AS owns FROM pg_roles r WHERE r.rolname=current_user`,
    );
    const role = result.rows[0];
    if (
      !role?.app ||
      role.rolsuper ||
      role.rolbypassrls ||
      role.api ||
      role.worker ||
      role.owns
    )
      throw new Error(
        "DATABASE_URL must be a restricted polli_app login that does not own tables.",
      );
    await pool.query("SELECT 1 FROM brownbag.payloads LIMIT 0");
    return createApp({
      pool,
      platformUrl,
      origins: (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    });
  } catch (e) {
    await pool.end();
    throw e;
  }
}
