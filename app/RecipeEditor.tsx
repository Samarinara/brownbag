import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Field, Input, Text } from "@samarinara/polli-ui";
import { storage } from "./storage";
import { importLink, uuid } from "./data";
import {
  itemSchema,
  recipeInputSchema,
  ingredientText,
  type Item,
  type RecipeInput,
  type Payload,
} from "../shared/model";
import { Sheet, s } from "./ui";
export function RecipeEditor({
  item,
  close,
  save,
  cloud,
  scope,
}: {
  item?: Item;
  close: () => void;
  save: (p: Payload, i?: Item, op?: string) => Promise<void>;
  cloud: boolean;
  scope: string;
}) {
  const original =
    item?.payload.kind === "recipe" ? item.payload.data : undefined;
  const [base, setBase] = useState<Partial<RecipeInput>>(original ?? {});
  const [title, setTitle] = useState(original?.title ?? "");
  const [ingredients, setIngredients] = useState(
    original?.ingredients.map(ingredientText).join("\n") ?? "",
  );
  const [steps, setSteps] = useState(
    original?.instructions.map((i) => i.text).join("\n\n") ?? "",
  );
  const [summary, setSummary] = useState(original?.summary ?? "");
  const [source, setSource] = useState(original?.source?.url ?? "");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    item: Item;
    operationId: string;
    fingerprint: string;
  } | null>(null);
  const draftKey = `brownbag.v1.draft.${scope}.${item?.id ?? "new"}`;
  const [hydrated, setHydrated] = useState(false);
  const writes = useRef(Promise.resolve());
  const completed = useRef(false);
  useEffect(() => {
    let active = true;
    void storage
      .get(draftKey)
      .then((raw) => {
        if (!active || !raw) return;
        const draft = JSON.parse(raw);
        for (const field of [
          "title",
          "ingredients",
          "steps",
          "summary",
          "source",
          "link",
        ])
          if (typeof draft[field] !== "string")
            throw new Error("Cannot read this draft.");
        setTitle(draft.title);
        setIngredients(draft.ingredients);
        setSteps(draft.steps);
        setSummary(draft.summary);
        setSource(draft.source);
        setLink(draft.link);
        setBase(recipeInputSchema.partial().parse(draft.base));
        if (draft.pending) {
          setPending({
            ...draft.pending,
            item: itemSchema.parse(draft.pending.item),
          });
        }
      })
      .catch(() => {
        if (active) setError("Could not restore the saved draft.");
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!hydrated || completed.current) return;
    const raw = JSON.stringify({
      title,
      ingredients,
      steps,
      summary,
      source,
      link,
      base,
      pending,
    });
    writes.current = writes.current
      .then(() => storage.set(draftKey, raw))
      .catch(() => setError("Could not save this draft on your device."));
  }, [
    hydrated,
    title,
    ingredients,
    steps,
    summary,
    source,
    link,
    base,
    pending,
    draftKey,
  ]);
  function fill(recipe: RecipeInput) {
    setBase(recipe);
    setTitle(recipe.title);
    setSummary(recipe.summary ?? "");
    setIngredients(recipe.ingredients.map(ingredientText).join("\n"));
    setSteps(recipe.instructions.map((i) => i.text).join("\n\n"));
    setSource(recipe.source?.url ?? "");
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      const payload = await importLink(link);
      if (payload.kind === "recipe") fill(payload.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const data = recipeInputSchema.parse({
        ...base,
        title,
        summary: summary || undefined,
        source: source ? { ...base.source, url: source } : undefined,
        ingredients:
          ingredients === base.ingredients?.map(ingredientText).join("\n")
            ? base.ingredients
            : ingredients
                .split("\n")
                .map((name) => name.trim())
                .filter(Boolean)
                .map((name) => ({ name })),
        instructions:
          steps === base.instructions?.map((i) => i.text).join("\n\n")
            ? base.instructions
            : steps
                .split(/\n\s*\n/)
                .map((text) => text.trim())
                .filter(Boolean)
                .map((text) => ({ text })),
      });
      const payload: Payload = { kind: "recipe", data };
      const fingerprint = JSON.stringify(payload);
      // Retain the ID and operation ID for an unchanged retry after a lost response.
      const operation =
        pending?.fingerprint === fingerprint
          ? pending
          : {
              item: item ?? {
                id: uuid(),
                revision: 0,
                updatedAt: new Date().toISOString(),
                payload,
              },
              operationId: uuid(),
              fingerprint,
            };
      setPending(operation);
      await writes.current;
      await storage.set(
        draftKey,
        JSON.stringify({
          title,
          ingredients,
          steps,
          summary,
          source,
          link,
          base,
          pending: operation,
        }),
      );
      await save(payload, operation.item, operation.operationId);
      completed.current = true;
      await writes.current;
      await storage.set(draftKey, "");
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save recipe.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={item ? "Edit recipe" : "Add recipe"} close={close}>
      {!item && (
        <View style={{ gap: 12 }}>
          <Field label="Recipe link">
            <Input
              style={s.field}
              accessibilityLabel="Recipe link"
              placeholder="https://…"
              value={link}
              onChangeText={setLink}
              autoCapitalize="none"
              keyboardType="url"
            />
          </Field>
          <Button
            variant="secondary"
            disabled={busy || !hydrated || !link.trim() || !cloud}
            onPress={() => void load()}
          >
            Import link
          </Button>
          {!cloud && (
            <Text style={s.muted}>
              Sign in with Polli to import a link, or write a recipe below.
            </Text>
          )}
        </View>
      )}
      <Field label="Name">
        <Input style={s.field} value={title} onChangeText={setTitle} />
      </Field>
      <Field label="Ingredients" description="One ingredient per line.">
        <Input
          style={[s.field, s.multiline]}
          value={ingredients}
          onChangeText={setIngredients}
          multiline
        />
      </Field>
      <Field label="Method" description="Leave an empty line between steps.">
        <Input
          style={[s.field, s.multiline]}
          value={steps}
          onChangeText={setSteps}
          multiline
        />
      </Field>
      <Field label="Notes">
        <Input
          style={[s.field, s.multiline]}
          value={summary}
          onChangeText={setSummary}
          multiline
        />
      </Field>
      <Field label="Source">
        <Input
          style={s.field}
          value={source}
          onChangeText={setSource}
          autoCapitalize="none"
          keyboardType="url"
        />
      </Field>
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button onPress={() => void submit()} disabled={busy || !hydrated}>
        {busy ? "Saving…" : "Save recipe"}
      </Button>
    </Sheet>
  );
}
