import React, { useState } from "react";
import { Linking, View } from "react-native";
import { Button, Field, Input, Text } from "@samarinara/polli-ui";
import { configured } from "./auth";
import { backup } from "./backup";
import { storage } from "./storage";
import { itemSchema, type Item, type Payload } from "../shared/model";
import { Sheet, s } from "./ui";
export function Settings({
  account,
  items,
  close,
  login,
  logout,
  refresh,
  save,
}: {
  account: string | null;
  items: Item[];
  close: () => void;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (p: Payload, i?: Item) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [restore, setRestore] = useState("");
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  async function importLocal() {
    const raw = await storage.get("brownbag.v1.local");
    const local = itemSchema.array().parse(JSON.parse(raw ?? "[]"));
    let copied = 0;
    for (const item of local) {
      if (items.some((i) => i.id === item.id)) continue;
      await save(item.payload, { ...item, revision: 0 });
      copied++;
    }
    setMessage(`${copied} items added to Polli. Local copies kept.`);
  }
  return (
    <Sheet title="Your Brownbag" close={close}>
      <Button
        disabled={busy || (!account && !configured)}
        onPress={() => void act(account ? logout : login)}
      >
        {account ? "Sign out" : "Sign in with Polli"}
      </Button>
      <Text style={s.muted}>
        {account
          ? "Recipes save to your Polli account."
          : "Recipes save on this device until you choose to add them to Polli."}
      </Text>
      {!configured && (
        <Text style={s.muted}>Sign-in is unavailable in this build.</Text>
      )}
      <View style={{ gap: 12 }}>
        <Button
          variant="secondary"
          disabled={busy}
          onPress={() => void act(refresh)}
        >
          Refresh cookbook
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onPress={() => void act(() => backup(items))}
        >
          Export backup
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onPress={() =>
            void act(() => Linking.openURL("https://accounts.polli.page"))
          }
        >
          Polli account settings
        </Button>
        {account && (
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => void act(importLocal)}
          >
            Add this device’s recipes to Polli
          </Button>
        )}
      </View>
      <Field
        label="Restore a backup"
        description="Paste a Brownbag backup. Existing IDs are skipped."
      >
        <Input
          accessibilityLabel="Backup JSON"
          style={[s.field, s.multiline]}
          multiline
          value={restore}
          onChangeText={setRestore}
        />
      </Field>
      <Button
        variant="secondary"
        disabled={busy || !restore.trim()}
        onPress={() =>
          void act(async () => {
            const parsed = JSON.parse(restore);
            const incoming = itemSchema.array().parse(parsed.items);
            for (const item of incoming) {
              if (!items.some((i) => i.id === item.id))
                await save(item.payload, { ...item, revision: 0 });
            }
            setRestore("");
            setMessage("Backup restored.");
          })
        }
      >
        Restore backup
      </Button>

      {!!message && (
        <Text accessibilityRole="alert" style={s.paragraph}>
          {message}
        </Text>
      )}
    </Sheet>
  );
}
