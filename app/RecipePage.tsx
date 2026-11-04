import React, { useState } from "react";
import { Linking, Share, View } from "react-native";
import { Button, Text } from "@samarinara/polli-ui";
import { Share2 } from "lucide-react-native";
import { ingredientText, type Item } from "../shared/model";
import { IconButton, Sheet, s } from "./ui";
export function RecipePage({
  item,
  close,
  edit,
  remove,
  plan,
}: {
  item: Item;
  close: () => void;
  edit: () => void;
  remove: () => Promise<void>;
  plan: () => void;
}) {
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (item.payload.kind !== "recipe") return null;
  const recipe = item.payload.data;
  return (
    <Sheet title={recipe.title} close={close}>
      <View style={s.spread}>
        <Text style={s.muted}>
          {[
            recipe.yield?.display,
            recipe.cookMinutes ? `${recipe.cookMinutes} min` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <IconButton
          icon={Share2}
          label="Share recipe"
          onPress={() =>
            void Share.share({
              message: [
                recipe.title,
                ...recipe.ingredients.map(ingredientText),
                "",
                ...recipe.instructions.map(
                  (step, i) => `${i + 1}. ${step.text}`,
                ),
                recipe.source?.url ?? "",
              ].join("\n"),
            }).catch(() => setError("Could not share this recipe."))
          }
        />
      </View>
      {!!recipe.summary && (
        <Text variant="input" style={s.name}>
          {recipe.summary}
        </Text>
      )}
      {!!recipe.description && (
        <Text style={s.paragraph}>{recipe.description}</Text>
      )}
      <Text variant="heading" style={s.heading}>
        Ingredients
      </Text>
      {recipe.ingredients.map((i, n) => (
        <Text key={n} variant="input" style={s.name}>
          {ingredientText(i)}
        </Text>
      ))}
      <Text variant="heading" style={s.heading}>
        Method
      </Text>
      {recipe.instructions.map((step, i) => (
        <View key={i} style={{ gap: 8 }}>
          <Text style={s.muted}>
            {step.group ? `${i + 1} · ${step.group}` : `${i + 1}`}
          </Text>
          <Text style={s.paragraph}>{step.text}</Text>
        </View>
      ))}
      {!!recipe.source?.url && (
        <Button
          variant="ghost"
          onPress={() =>
            void Linking.openURL(recipe.source!.url!).catch(() =>
              setError("Could not open the source."),
            )
          }
        >
          Original recipe
        </Button>
      )}
      <Button onPress={plan}>Plan a meal</Button>
      <Button variant="secondary" onPress={edit}>
        Edit recipe
      </Button>
      {confirm ? (
        <View style={{ gap: 12 }}>
          <Text>Delete this recipe? Planned meals keep their names.</Text>
          <Button
            variant="destructive"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void remove()
                .then(close)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Delete recipe
          </Button>
          <Button variant="ghost" onPress={() => setConfirm(false)}>
            Keep recipe
          </Button>
        </View>
      ) : (
        <Button variant="ghost" onPress={() => setConfirm(true)}>
          Delete recipe
        </Button>
      )}
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </Sheet>
  );
}
