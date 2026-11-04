import * as Crypto from "expo-crypto";
import { createPlatformClient } from "@polli/platform-client";
import { getToken } from "./auth";
import {
  itemSchema,
  payloadSchema,
  type Item,
  type Payload,
} from "../shared/model";
export const uuid = () => Crypto.randomUUID();
const origin = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const platform = createPlatformClient(
  process.env.EXPO_PUBLIC_PLATFORM_URL ?? "https://api.polli.page",
  getToken,
);
export async function request(path: string, init: RequestInit = {}) {
  const token = await getToken();
  if (!token) throw new Error("Sign in with Polli first.");
  const res = await fetch(`${origin}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "The request failed. Try again.");
  return data;
}
export async function fetchItems(before?: string) {
  const page = await request(
    `/items${before ? "?before=" + encodeURIComponent(before) : ""}`,
  );
  return {
    items: itemSchema.array().parse(page.items),
    next: page.next as string | null,
  };
}
export async function saveRemote(item: Item, operationId: string) {
  return itemSchema.parse(
    await request("/items/" + item.id, {
      method: "PUT",
      body: JSON.stringify({
        revision: item.revision,
        payload: item.payload,
        operationId,
      }),
    }),
  );
}
export async function removeRemote(item: Item, operationId: string) {
  await request("/items/" + item.id, {
    method: "DELETE",
    body: JSON.stringify({ revision: item.revision, operationId }),
  });
}
export async function importLink(url: string): Promise<Payload> {
  return payloadSchema.parse(
    await request("/import", { method: "POST", body: JSON.stringify({ url }) }),
  );
}
