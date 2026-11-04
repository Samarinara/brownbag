import express from "express";
import helmet from "helmet";
import { z } from "zod";
import {
  withAccountTransaction,
  type SQLPool,
  type SQLConnection,
} from "@polli/platform-server";
import { payloadSchema, saveSchema } from "../shared/model.js";
import { deleteItem, getItem, listItems, once, saveItem } from "./store.js";
import { importRecipe } from "./recipe-import.js";
import { HttpError } from "./errors.js";
export type AccountTransaction = <T>(
  token: string,
  fn: (tx: SQLConnection, id: string) => Promise<T>,
) => Promise<T>;
export function createApp(options: {
  pool: SQLPool;
  platformUrl: string;
  origins: string[];
  transaction?: AccountTransaction;
  importer?: typeof importRecipe;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin) {
      if (!options.origins.includes(origin)) {
        res.status(403).json({ error: "Origin is not allowed." });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,PUT,POST,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  const transaction: AccountTransaction =
    options.transaction ??
    ((accessToken, fn) =>
      withAccountTransaction(
        { pool: options.pool, platformUrl: options.platformUrl, accessToken },
        fn,
      ));
  const authorized = async <T>(
    req: express.Request,
    fn: (tx: SQLConnection, id: string) => Promise<T>,
  ) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? "");
    if (!match) throw new HttpError(401, "Sign in with Polli.");
    return transaction(match[1], fn);
  };
  app.get("/api/items", async (req, res) => {
    const before = z.uuid().optional().parse(req.query.before);
    res.json(await authorized(req, (tx) => listItems(tx, before)));
  });
  app.get("/api/items/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const item = await authorized(req, (tx) => getItem(tx, id));
    if (!item) throw new HttpError(404, "Item not found.");
    res.json(item);
  });
  app.put("/api/items/:id", async (req, res) => {
    const input = saveSchema
      .extend({ operationId: z.uuid() })
      .parse({ ...req.body, id: z.uuid().parse(req.params.id) });
    res.json(
      await authorized(req, (tx, id) =>
        once(tx, id, input.operationId, input, input.id, () =>
          saveItem(tx, id, input),
        ),
      ),
    );
  });
  app.delete("/api/items/:id", async (req, res) => {
    const input = z
      .object({ revision: z.number().int().positive(), operationId: z.uuid() })
      .strict()
      .parse(req.body);
    const id = z.uuid().parse(req.params.id);
    res.json(
      await authorized(req, (tx, account) =>
        once(tx, account, input.operationId, { ...input, id }, null, () =>
          deleteItem(tx, id, input.revision),
        ),
      ),
    );
  });
  app.post("/api/import", async (req, res) => {
    const { url } = z
      .object({ url: z.string().max(2000) })
      .strict()
      .parse(req.body);
    // Verify account before the remote fetch, but do not hold a DB transaction during network IO.
    await authorized(req, async () => undefined);
    const recipe = await (options.importer ?? importRecipe)(url);
    res.json(payloadSchema.parse({ kind: "recipe", data: recipe }));
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: error.issues.map((i) => i.message).join(" ") });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const e = error as {
        code?: string;
        data?: { httpStatus?: number };
        status?: number;
      };
      if (e.data?.httpStatus === 401 || e.data?.httpStatus === 403) {
        res
          .status(e.data.httpStatus)
          .json({ error: "Sign in with an active Polli account." });
        return;
      }
      if (e.code === "P0001") {
        res.status(409).json({
          error:
            "This item changed on another device. Refresh and compare before saving.",
        });
        return;
      }
      if (e.code === "42501") {
        res.status(403).json({ error: "Your account cannot edit this item." });
        return;
      }
      if (e.status === 413) {
        res.status(413).json({ error: "This recipe is too large." });
        return;
      }
      res.status(503).json({
        error:
          "Brownbag could not reach Polli. Your changes have not been saved. Try again.",
      });
    },
  );
  return app;
}
