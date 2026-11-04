import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { itemSchema, type Item, type Payload } from "../shared/model";
import { configured, getToken, signIn, signOut } from "./auth";
import { fetchItems, platform, removeRemote, saveRemote, uuid } from "./data";
import { storage } from "./storage";
const localKey = "brownbag.v1.local";
export function useCookbook() {
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Item[]>([]);
  const accountRef = useRef<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const replace = useCallback((data: Item[]) => {
    current.current = data;
    setItems(data);
  }, []);
  const refresh = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const gen = generation.current;
    try {
      const token = configured ? await getToken() : undefined;
      if (!token) {
        const saved = await storage.get(localKey);
        if (gen !== generation.current) return;
        accountRef.current = null;
        setAccount(null);
        setNext(null);
        replace(saved ? itemSchema.array().parse(JSON.parse(saved)) : []);
        return;
      }
      const profile = await platform.profile.query();
      if (profile.status !== "active")
        throw new Error(
          "Your Polli account is pending deletion. Open account settings.",
        );
      const key = "brownbag.v1.account." + profile.id;
      const saved = await storage.get(key);
      if (gen !== generation.current) return;
      if (accountRef.current !== profile.id) {
        replace(saved ? itemSchema.array().parse(JSON.parse(saved)) : []);
        accountRef.current = profile.id;
        setAccount(profile.id);
      }
      const remote = await fetchItems();
      if (gen !== generation.current) return;
      await storage.set(key, JSON.stringify(remote.items));
      replace(remote.items);
      setNext(remote.next);
      setError(null);
    } catch (e) {
      if (gen === generation.current)
        setError(
          e instanceof Error ? e.message : "Could not load your cookbook.",
        );
    } finally {
      lock.current = false;
      setBusy(false);
      setReady(true);
    }
  }, [replace]);
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    const online = () => void refresh();
    if (Platform.OS === "web") window.addEventListener("online", online);
    return () => {
      sub.remove();
      if (Platform.OS === "web") window.removeEventListener("online", online);
    };
  }, [refresh]);
  async function mutate(action: () => Promise<Item[]>) {
    if (lock.current) throw new Error("Wait for the current save to finish.");
    lock.current = true;
    setBusy(true);
    try {
      const next = await action();
      await storage.set(
        accountRef.current
          ? "brownbag.v1.account." + accountRef.current
          : localKey,
        JSON.stringify(next),
      );
      replace(next);
      setError(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(payload: Payload, existing?: Item, operationId = uuid()) {
    const item: Item = {
      id: existing?.id ?? uuid(),
      revision: existing?.revision ?? 0,
      updatedAt: new Date().toISOString(),
      payload,
    };
    await mutate(async () => {
      const saved = accountRef.current
        ? await saveRemote(item, operationId)
        : { ...item, revision: item.revision + 1 };
      return [saved, ...current.current.filter((i) => i.id !== saved.id)];
    });
  }
  async function remove(item: Item) {
    await mutate(async () => {
      if (accountRef.current) await removeRemote(item, uuid());
      return current.current.filter((i) => i.id !== item.id);
    });
  }
  async function login() {
    await signIn();
    await refresh();
  }
  async function logout() {
    if (lock.current) throw new Error("Wait for the current save to finish.");
    generation.current++;
    await signOut();
    accountRef.current = null;
    setAccount(null);
    replace([]);
    await refresh();
  }
  async function loadMore() {
    if (!next || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const page = await fetchItems(next);
      const merged = [
        ...current.current,
        ...page.items.filter(
          (i) => !current.current.some((old) => old.id === i.id),
        ),
      ];
      await storage.set(
        "brownbag.v1.account." + accountRef.current,
        JSON.stringify(merged),
      );
      replace(merged);
      setNext(page.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    items,
    account,
    ready,
    busy,
    error,
    setError,
    refresh,
    loadMore,
    next,
    save,
    remove,
    login,
    logout,
  };
}
