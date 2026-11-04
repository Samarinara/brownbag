import React, { useState } from "react";
import { View } from "react-native";
import { Button, Checkbox, Input, Text } from "@samarinara/polli-ui";
import { Trash2 } from "lucide-react-native";
import {
  dayKey,
  ingredientText,
  type Item,
  type Payload,
} from "../shared/model";
import { IconButton, s } from "./ui";
export function Shopping({
  items,
  save,
  remove,
}: {
  items: Item[];
  save: (p: Payload, i?: Item) => Promise<void>;
  remove: (i: Item) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shopping = items.filter((i) => i.payload.kind === "shopping");
  async function generate() {
    const today = dayKey();
    const end = new Date();
    end.setDate(end.getDate() + 6);
    const until = dayKey(end);
    const names: string[] = [];
    for (const meal of items) {
      if (
        meal.payload.kind !== "meal" ||
        meal.payload.data.date < today ||
        meal.payload.data.date > until
      )
        continue;
      const recipe = items.find(
        (i) =>
          i.id ===
          (meal.payload as Extract<Payload, { kind: "meal" }>).data.recipeId,
      );
      if (recipe?.payload.kind === "recipe")
        names.push(...recipe.payload.data.ingredients.map(ingredientText));
    }
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const [n, count] of counts) {
      const label = count > 1 ? `${n} × ${count}` : n;
      if (
        !shopping.some(
          (i) => i.payload.kind === "shopping" && i.payload.data.name === label,
        )
      )
        await save({ kind: "shopping", data: { name: label, checked: false } });
    }
    if (!names.length)
      throw new Error("Plan a meal for the next seven days first.");
  }
  return (
    <>
      <View style={s.row}>
        <Input
          accessibilityLabel="Shopping item"
          placeholder="Add to your list"
          style={[s.field, { flex: 1 }]}
          value={name}
          onChangeText={setName}
        />
        <Button
          disabled={busy || !name.trim()}
          onPress={() =>
            void act(async () => {
              await save({
                kind: "shopping",
                data: { name: name.trim(), checked: false },
              });
              setName("");
            })
          }
        >
          Add
        </Button>
      </View>
      <Button
        variant="secondary"
        disabled={busy}
        onPress={() => void act(generate)}
      >
        Add this week’s ingredients
      </Button>
      <Text style={s.muted}>
        Includes the next seven days. Repeated ingredients use × for whole
        recipe amounts.
      </Text>
      {shopping
        .sort(
          (a, b) =>
            Number(a.payload.kind === "shopping" && a.payload.data.checked) -
            Number(b.payload.kind === "shopping" && b.payload.data.checked),
        )
        .map(
          (item) =>
            item.payload.kind === "shopping" && (
              <View key={item.id} style={s.row}>
                <Checkbox
                  accessibilityLabel={item.payload.data.name}
                  checked={item.payload.data.checked}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    void act(() =>
                      save(
                        {
                          kind: "shopping",
                          data: {
                            name:
                              item.payload.kind === "shopping"
                                ? item.payload.data.name
                                : "",
                            checked,
                          },
                        },
                        item,
                      ),
                    )
                  }
                />
                <Text
                  variant="input"
                  style={[
                    s.name,
                    item.payload.data.checked && {
                      textDecorationLine: "line-through",
                      opacity: 0.55,
                    },
                  ]}
                >
                  {item.payload.data.name}
                </Text>
                <IconButton
                  icon={Trash2}
                  label={`Remove ${item.payload.data.name}`}
                  disabled={busy}
                  onPress={() => void act(() => remove(item))}
                />
              </View>
            ),
        )}
      {!shopping.length && (
        <View style={s.empty}>
          <Text variant="heading" style={s.heading}>
            Ready for the next shop.
          </Text>
        </View>
      )}
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </>
  );
}
