import type { Item } from "../shared/model";
export async function backup(items: Item[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ version: 1, items }, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "brownbag-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
