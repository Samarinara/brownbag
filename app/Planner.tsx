import React, { useState } from "react";
import { View } from "react-native";
import { Button, Input, Field, Text } from "@samarinara/polli-ui";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react-native";
import { dayKey, dateSchema, type Item, type Payload } from "../shared/model";
import { IconButton, Sheet, s } from "./ui";
export function Planner({
  items,
  save,
  remove,
  open,
}: {
  items: Item[];
  save: (p: Payload, i?: Item) => Promise<void>;
  remove: (i: Item) => Promise<void>;
  open: (i: Item) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [pick, setPick] = useState<{
    date: string;
    slot: "Breakfast" | "Lunch" | "Dinner";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = new Date();
  start.setDate(start.getDate() + offset);
  const days = Array.from({ length: 7 }, (_, n) => {
    const d = new Date(start);
    d.setDate(d.getDate() + n);
    return d;
  });
  return (
    <>
      <View style={s.spread}>
        <IconButton
          icon={ChevronLeft}
          label="Previous week"
          onPress={() => setOffset((o) => o - 7)}
        />
        <Button variant="ghost" onPress={() => setOffset(0)}>
          Today
        </Button>
        <IconButton
          icon={ChevronRight}
          label="Next week"
          onPress={() => setOffset((o) => o + 7)}
        />
      </View>
      {days.map((day) => (
        <View key={dayKey(day)} style={{ gap: 12, paddingVertical: 12 }}>
          <Text variant="heading" style={s.heading}>
            {day.toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </Text>
          {(["Breakfast", "Lunch", "Dinner"] as const).map((slot) => (
            <View key={slot} style={{ gap: 8 }}>
              <View style={s.spread}>
                <Text style={s.muted}>{slot}</Text>
                <IconButton
                  icon={Plus}
                  label={`Add ${slot.toLowerCase()} for ${dayKey(day)}`}
                  onPress={() => setPick({ date: dayKey(day), slot })}
                />
              </View>
              {items
                .filter(
                  (i) =>
                    i.payload.kind === "meal" &&
                    i.payload.data.date === dayKey(day) &&
                    i.payload.data.slot === slot,
                )
                .map((meal) => (
                  <View style={s.row} key={meal.id}>
                    <Button
                      variant="secondary"
                      style={{ flex: 1, justifyContent: "flex-start" }}
                      onPress={() => {
                        if (meal.payload.kind !== "meal") return;
                        const recipeId = meal.payload.data.recipeId;
                        const recipe = items.find((i) => i.id === recipeId);
                        if (recipe) open(recipe);
                        else
                          setError(
                            "The original recipe is no longer in your cookbook.",
                          );
                      }}
                    >
                      {meal.payload.kind === "meal"
                        ? meal.payload.data.title
                        : ""}
                    </Button>
                    <IconButton
                      icon={Trash2}
                      label="Remove planned meal"
                      disabled={busy}
                      onPress={() => {
                        setBusy(true);
                        void remove(meal)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(false));
                      }}
                    />
                  </View>
                ))}
            </View>
          ))}
        </View>
      ))}
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {pick && (
        <Sheet title="Choose a recipe" close={() => setPick(null)}>
          {items
            .filter((i) => i.payload.kind === "recipe")
            .map((recipe) => (
              <Button
                key={recipe.id}
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  if (recipe.payload.kind !== "recipe") return;
                  setBusy(true);
                  void save({
                    kind: "meal",
                    data: {
                      ...pick,
                      recipeId: recipe.id,
                      title: recipe.payload.data.title,
                    },
                  })
                    .then(() => setPick(null))
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                {recipe.payload.kind === "recipe"
                  ? recipe.payload.data.title
                  : ""}
              </Button>
            ))}
          {!items.some((i) => i.payload.kind === "recipe") && (
            <Text>Add a recipe to your cookbook first.</Text>
          )}
          {!!error && <Text style={s.error}>{error}</Text>}
        </Sheet>
      )}
    </>
  );
}
export function PlanRecipe({
  recipe,
  save,
  close,
}: {
  recipe: Item;
  save: (p: Payload) => Promise<void>;
  close: () => void;
}) {
  const [date, setDate] = useState(dayKey());
  const [slot, setSlot] = useState<"Breakfast" | "Lunch" | "Dinner">("Dinner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title="Plan a meal" close={close}>
      <Field label="Date" description="YYYY-MM-DD">
        <Input value={date} onChangeText={setDate} style={s.field} />
      </Field>
      <View style={{ gap: 10 }}>
        {(["Breakfast", "Lunch", "Dinner"] as const).map((v) => (
          <Button
            key={v}
            variant={slot === v ? "default" : "secondary"}
            onPress={() => setSlot(v)}
          >
            {v}
          </Button>
        ))}
      </View>
      <Button
        disabled={busy}
        onPress={() => {
          setError("");
          if (!dateSchema.safeParse(date).success) {
            setError("Enter a valid date as YYYY-MM-DD.");
            return;
          }
          if (recipe.payload.kind !== "recipe") return;
          setBusy(true);
          void save({
            kind: "meal",
            data: {
              recipeId: recipe.id,
              title: recipe.payload.data.title,
              date,
              slot,
            },
          })
            .then(close)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Add meal
      </Button>
      {!!error && <Text style={s.error}>{error}</Text>}
    </Sheet>
  );
}
