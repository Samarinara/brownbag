import { Share } from "react-native";
import type { Item } from "../shared/model";
export async function backup(items: Item[]) {
  await Share.share({
    message: JSON.stringify({ version: 1, items }, null, 2),
    title: "Brownbag backup",
  });
}
