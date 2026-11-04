import { pgSchema, uuid, jsonb } from "drizzle-orm/pg-core";
import type { Payload } from "../shared/model.js";
export const brownbag = pgSchema("brownbag");
export const payloads = brownbag.table("payloads", {
  entityId: uuid("entity_id").primaryKey(),
  payload: jsonb("payload").$type<Payload>().notNull(),
});
