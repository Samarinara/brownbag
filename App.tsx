import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import {
  Button,
  Input,
  PolliProvider,
  Text,
  palette,
} from "@samarinara/polli-ui";
import {
  BookOpen,
  CalendarDays,
  ShoppingBasket,
  Plus,
  Search,
  UserRound,
  ChevronRight,
  X,
} from "lucide-react-native";
import type { Item } from "./shared/model";
import { useCookbook } from "./app/useCookbook";
import { Bowl } from "./app/Bowl";
import { RecipeEditor } from "./app/RecipeEditor";
import { RecipePage } from "./app/RecipePage";
import { Planner, PlanRecipe } from "./app/Planner";
import { Shopping } from "./app/Shopping";
import { Settings } from "./app/Settings";
import { IconButton, s } from "./app/ui";
export default function App() {
  const [fonts, error] = useFonts({
    Lora: require("./assets/fonts/lora.ttf"),
    PatrickHand: require("./assets/fonts/patrick_hand.ttf"),
  });
  if (!fonts && !error) return null;
  return (
    <SafeAreaProvider>
      <PolliProvider
        mode="light"
        fonts={fonts ? { heading: "Lora", input: "PatrickHand" } : undefined}
      >
        <StatusBar style="dark" />
        <Cookbook />
      </PolliProvider>
    </SafeAreaProvider>
  );
}
function Cookbook() {
  const state = useCookbook();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"recipes" | "plan" | "shop">("recipes");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const [planning, setPlanning] = useState<Item | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    setSelected(null);
    setEditing(undefined);
    setPlanning(null);
  }, [state.account]);
  const recipes = state.items.filter(
    (i) =>
      i.payload.kind === "recipe" &&
      [
        i.payload.data.title,
        ...(i.payload.data.tags ?? []),
        ...i.payload.data.ingredients.map((x) => x.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = state.items.find((i) => i.id === selected?.id) ?? selected;
  return (
    <SafeAreaView style={s.page} edges={["top", "left", "right"]}>
      <View style={s.header}>
        <Text variant="heading" accessibilityRole="header" style={s.title}>
          {tab === "recipes"
            ? "Your cookbook"
            : tab === "plan"
              ? "At the table"
              : "Shopping list"}
        </Text>
        <IconButton
          icon={UserRound}
          label="Account and settings"
          onPress={() => setSettings(true)}
        />
      </View>
      {!!state.error && (
        <View style={[s.row, { paddingHorizontal: 24, paddingBottom: 12 }]}>
          <Text accessibilityRole="alert" style={[s.error, { flex: 1 }]}>
            {state.error}
          </Text>
          <IconButton
            icon={X}
            label="Dismiss message"
            onPress={() => state.setError(null)}
          />
        </View>
      )}
      {!state.ready ? (
        <View style={s.empty}>
          <ActivityIndicator
            color={palette.green}
            accessibilityLabel="Opening cookbook"
          />
        </View>
      ) : tab === "recipes" ? (
        <>
          <View style={s.search}>
            <Search size={20} color={palette.ink} />
            <Input
              style={s.searchInput}
              accessibilityLabel="Find a recipe"
              placeholder="Find a recipe"
              value={query}
              onChangeText={setQuery}
            />
            {!!query && (
              <IconButton
                icon={X}
                label="Clear search"
                onPress={() => setQuery("")}
              />
            )}
          </View>
          <FlatList
            data={recipes}
            keyExtractor={(i) => i.id}
            contentContainerStyle={[s.content, { paddingTop: 0, gap: 0 }]}
            refreshControl={
              <RefreshControl
                refreshing={state.busy}
                onRefresh={() => void state.refresh()}
              />
            }
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) =>
              item.payload.kind === "recipe" ? (
                <Button
                  variant="ghost"
                  accessibilityLabel={`Open ${item.payload.data.title}`}
                  onPress={() => setSelected(item)}
                  style={s.recipe}
                >
                  <View
                    style={[
                      s.badge,
                      {
                        backgroundColor: [
                          palette.yellow,
                          palette.mint,
                          palette.coral,
                          palette.blue,
                        ][index % 4],
                      },
                    ]}
                  >
                    <BookOpen size={26} color={palette.green} />
                  </View>
                  <Text variant="input" style={s.name}>
                    {item.payload.data.title}
                  </Text>
                  <ChevronRight size={20} color={palette.green} />
                </Button>
              ) : null
            }
            ListFooterComponent={
              state.next ? (
                <Button
                  variant="ghost"
                  disabled={state.busy}
                  onPress={() => void state.loadMore()}
                >
                  Load more
                </Button>
              ) : undefined
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <Bowl />
                <Text variant="heading" style={s.heading}>
                  {query ? "No recipes found." : "Something worth making."}
                </Text>
                <Button
                  onPress={() => (query ? setQuery("") : setEditing(null))}
                >
                  {query ? "Clear search" : "Add a recipe"}
                </Button>
              </View>
            }
          />
        </>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl
              refreshing={state.busy}
              onRefresh={() => void state.refresh()}
            />
          }
        >
          {tab === "plan" ? (
            <Planner
              items={state.items}
              save={state.save}
              remove={state.remove}
              open={setSelected}
            />
          ) : (
            <Shopping
              items={state.items}
              save={state.save}
              remove={state.remove}
            />
          )}
        </ScrollView>
      )}
      <View
        style={[s.dockWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        <View style={s.dock}>
          <IconButton
            icon={BookOpen}
            label="Recipes"
            active={tab === "recipes"}
            onPress={() => setTab("recipes")}
          />
          <IconButton
            icon={CalendarDays}
            label="Meal plan"
            active={tab === "plan"}
            onPress={() => setTab("plan")}
          />
          <IconButton
            icon={ShoppingBasket}
            label="Shopping"
            active={tab === "shop"}
            onPress={() => setTab("shop")}
          />
          <Button
            size="icon"
            style={{ width: 56, height: 56 }}
            accessibilityLabel="Add recipe"
            onPress={() => setEditing(null)}
          >
            <Plus size={26} color={palette.white} />
          </Button>
        </View>
      </View>
      {settings && (
        <Settings
          account={state.account}
          items={state.items}
          close={() => setSettings(false)}
          login={state.login}
          logout={state.logout}
          refresh={state.refresh}
          save={state.save}
        />
      )}
      {current && (
        <RecipePage
          item={current}
          close={() => setSelected(null)}
          edit={() => setEditing(current)}
          remove={() => state.remove(current)}
          plan={() => setPlanning(current)}
        />
      )}
      {planning && (
        <PlanRecipe
          recipe={planning}
          save={state.save}
          close={() => setPlanning(null)}
        />
      )}
      {editing !== undefined && (
        <RecipeEditor
          item={editing ?? undefined}
          close={() => setEditing(undefined)}
          save={state.save}
          cloud={!!state.account}
          scope={state.account ?? "local"}
        />
      )}
    </SafeAreaView>
  );
}
