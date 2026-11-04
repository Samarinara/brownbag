import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLConnection } from "@polli/platform-server";
import {
  saveItem,
  deleteItem,
  getItem,
  listItems,
  once,
} from "../server/store.js";
import type { Payload } from "../shared/model.js";
const owner = randomUUID(),
  other = randomUUID();
const recipe: Payload = {
  kind: "recipe",
  data: {
    title: "Lemon rice",
    ingredients: [{ name: "rice", quantity: "1", unit: "cup" }],
    instructions: [{ text: "Cook the rice." }],
  },
};
async function fixture() {
  const db = new PGlite();
  for (const name of [
    "0000_unique_mattie_franklin.sql",
    "0001_low_tigra.sql",
    "0002_access_rules.sql",
    "0003_brown_fixer.sql",
  ])
    await db.exec(
      await readFile(new URL("./platform/" + name, import.meta.url), "utf8"),
    );
  await db.exec(
    await readFile(
      new URL("../migrations/001_polli.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    "INSERT INTO platform.accounts(id,workos_id) VALUES($1,$2),($3,$4)",
    [owner, "user_owner", other, "user_other"],
  );
  const tx: SQLConnection = {
    query: async (text, values) => db.query(text, values),
    release() {},
  };
  async function as<T>(account: string, fn: () => Promise<T>) {
    await db.exec("BEGIN;SET LOCAL ROLE polli_app;");
    try {
      await db.query("SELECT set_config('polli.account_id',$1,true)", [
        account,
      ]);
      await db.query("SELECT platform.lock_account()");
      const r = await fn();
      await db.exec("COMMIT");
      return r;
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }
  return { db, tx, as };
}
test("app role isolates accounts, detects stale revisions, emits events, and cascades payload deletion", async () => {
  const { db, tx, as } = await fixture();
  try {
    const id = randomUUID();
    const created = await as(owner, () =>
      saveItem(tx, owner, { id, revision: 0, payload: recipe }),
    );
    assert.equal(created.revision, 1);
    assert.equal(await as(other, () => getItem(tx, id)), null);
    assert.deepEqual((await as(other, () => listItems(tx))).items, []);
    await assert.rejects(
      as(other, () =>
        saveItem(tx, other, { id, revision: 1, payload: recipe }),
      ),
      /no longer available/,
    );
    const edited = await as(owner, () =>
      saveItem(tx, owner, {
        id,
        revision: 1,
        payload: {
          ...recipe,
          data: { ...recipe.data, title: "More lemon rice" },
        },
      }),
    );
    assert.equal(edited.revision, 2);
    await assert.rejects(
      as(owner, () =>
        saveItem(tx, owner, { id, revision: 1, payload: recipe }),
      ),
      /changed/,
    );
    const latest = await as(owner, () => getItem(tx, id));
    assert.equal(
      latest?.payload.kind === "recipe" ? latest.payload.data.title : null,
      "More lemon rice",
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM platform.sync_events WHERE entity_id=$1",
          [id],
        )
      ).rows[0].count,
      2,
    );
    await as(owner, () => deleteItem(tx, id, 2));
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM brownbag.payloads",
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await db.close();
  }
});
test("operation retries return the original result and reject a changed request", async () => {
  const { db, tx, as } = await fixture();
  try {
    const id = randomUUID(),
      op = randomUUID();
    const input = { id, revision: 0, payload: recipe };
    const first = await as(owner, () =>
      once(tx, owner, op, input, id, () => saveItem(tx, owner, input)),
    );
    const second = await as(owner, () =>
      once(tx, owner, op, input, id, () => {
        throw new Error("must not run twice");
      }),
    );
    assert.deepEqual(second, first);
    await assert.rejects(
      as(owner, () =>
        once(tx, owner, op, { changed: true }, id, async () => null),
      ),
      /already used/,
    );
    await as(owner, () => deleteItem(tx, id, 1));
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM brownbag.receipts",
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await db.close();
  }
});
test("a viewer can read but cannot write or delete another account’s recipe", async () => {
  const { db, tx, as } = await fixture();
  try {
    const id = randomUUID();
    await as(owner, () =>
      saveItem(tx, owner, { id, revision: 0, payload: recipe }),
    );
    await as(owner, () =>
      tx.query(
        "INSERT INTO platform.relationships(entity_id,account_id,relation) VALUES($1,$2,'viewer')",
        [id, other],
      ),
    );
    assert.equal((await as(other, () => getItem(tx, id)))?.id, id);
    await assert.rejects(
      as(other, () =>
        saveItem(tx, other, { id, revision: 1, payload: recipe }),
      ),
      /changed/,
    );
    await assert.rejects(
      as(other, () => deleteItem(tx, id, 1)),
      /changed/,
    );
  } finally {
    await db.close();
  }
});
test("pending account deletion blocks the app transaction", async () => {
  const { db, tx, as } = await fixture();
  try {
    await db.query(
      "UPDATE platform.accounts SET status='pending_deletion',delete_after=now() WHERE id=$1",
      [owner],
    );
    await assert.rejects(
      as(owner, () => listItems(tx)),
      /account_unavailable/,
    );
  } finally {
    await db.close();
  }
});
