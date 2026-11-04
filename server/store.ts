import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { expectRevision, type SQLConnection } from "@polli/platform-server";
import { payloads } from "./schema.js";
import { HttpError } from "./errors.js";
import { titleOf, type Item, type Payload } from "../shared/model.js";
const builder = drizzle.mock();
const projection = `e.id,e.revision,e.updated_at AS "updatedAt",p.payload`;
const map = (row: Record<string, unknown>): Item =>
  ({
    ...row,
    updatedAt: new Date(row.updatedAt as string).toISOString(),
  }) as Item;
export async function getItem(tx: SQLConnection, id: string) {
  const r = await tx.query(
    `SELECT ${projection} FROM platform.entities e JOIN brownbag.payloads p ON p.entity_id=e.id WHERE e.id=$1`,
    [id],
  );
  return r.rows[0] ? map(r.rows[0]) : null;
}
export async function listItems(tx: SQLConnection, before?: string) {
  const r = await tx.query(
    `SELECT ${projection} FROM platform.entities e JOIN brownbag.payloads p ON p.entity_id=e.id WHERE ($1::uuid IS NULL OR (e.updated_at,e.id)<(SELECT updated_at,id FROM platform.entities WHERE id=$1::uuid)) ORDER BY e.updated_at DESC,e.id DESC LIMIT 101`,
    [before ?? null],
  );
  return {
    items: r.rows.slice(0, 100).map(map),
    next: r.rows.length > 100 ? String(r.rows[99].id) : null,
  };
}
export async function saveItem(
  tx: SQLConnection,
  accountId: string,
  input: { id: string; revision: number; payload: Payload },
) {
  if (input.revision === 0) {
    const r = await tx.query(
      `INSERT INTO platform.entities(id,owner_id,type,title) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [
        input.id,
        accountId,
        input.payload.kind === "recipe"
          ? "recipe"
          : `brownbag.${input.payload.kind}`,
        titleOf(input.payload),
      ],
    );
    if (!r.rows.length)
      throw new HttpError(
        409,
        "This item already exists. Refresh before saving.",
      );
    const q = builder
      .insert(payloads)
      .values({ entityId: input.id, payload: input.payload })
      .toSQL();
    await tx.query(q.sql, q.params);
  } else {
    const current = await getItem(tx, input.id);
    if (!current) throw new HttpError(404, "This item is no longer available.");
    if (current.payload.kind !== input.payload.kind)
      throw new HttpError(400, "An item cannot change type.");
    await expectRevision(tx, input.revision);
    const r = await tx.query(
      `UPDATE platform.entities SET title=$1 WHERE id=$2 AND revision=$3 RETURNING id`,
      [titleOf(input.payload), input.id, input.revision],
    );
    if (!r.rows.length)
      throw new HttpError(
        409,
        "This item changed on another device. Your edits are still here. Refresh and compare before saving.",
      );
    const q = builder
      .update(payloads)
      .set({ payload: input.payload })
      .where(eq(payloads.entityId, input.id))
      .toSQL();
    await tx.query(q.sql, q.params);
  }
  return (await getItem(tx, input.id))!;
}
export async function deleteItem(
  tx: SQLConnection,
  id: string,
  revision: number,
) {
  await expectRevision(tx, revision);
  const r = await tx.query(
    "DELETE FROM platform.entities WHERE id=$1 AND revision=$2 RETURNING id",
    [id, revision],
  );
  if (!r.rows.length)
    throw new HttpError(
      409,
      "This item changed or is unavailable. Refresh and try again.",
    );
  return { deleted: id };
}
export async function once<T>(
  tx: SQLConnection,
  accountId: string,
  operationId: string,
  request: unknown,
  entityId: string | null,
  run: () => Promise<T>,
): Promise<T> {
  const hash = createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    accountId + operationId,
  ]);
  const old = await tx.query(
    "SELECT request_hash,result FROM brownbag.receipts WHERE account_id=$1 AND operation_id=$2",
    [accountId, operationId],
  );
  if (old.rows.length) {
    if (old.rows[0].request_hash !== hash)
      throw new HttpError(409, "This operation ID was already used.");
    return old.rows[0].result as T;
  }
  const result = await run();
  await tx.query(
    "INSERT INTO brownbag.receipts(account_id,operation_id,entity_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
    [accountId, operationId, entityId, hash, JSON.stringify(result)],
  );
  return result;
}
