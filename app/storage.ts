import store from "expo-sqlite/kv-store";
export const storage = {
  get: (key: string) => store.getItem(key),
  set: (key: string, value: string) => store.setItem(key, value),
};
