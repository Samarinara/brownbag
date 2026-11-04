import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
test("API requires a bearer token before import and rejects untrusted browser origins", async () => {
  let transactions = 0,
    imports = 0;
  const app = createApp({
    pool: {
      async connect() {
        throw new Error("unused");
      },
    },
    platformUrl: "https://api.polli.page",
    origins: ["https://brownbag.polli.page"],
    transaction: async () => {
      transactions++;
      throw new Error("not authenticated");
    },
    importer: async () => {
      imports++;
      throw new Error("unused");
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const missing = await fetch(url + "/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(missing.status, 401);
    assert.equal(imports, 0);
    assert.equal(transactions, 0);
    const origin = await fetch(url + "/api/items", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(origin.status, 403);
    assert.equal(origin.headers.get("access-control-allow-origin"), null);
    const allowed = await fetch(url + "/api/items", {
      method: "OPTIONS",
      headers: { Origin: "https://brownbag.polli.page" },
    });
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://brownbag.polli.page",
    );
    const health = await fetch(url + "/health");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
