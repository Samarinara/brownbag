import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  View,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Text, palette } from "@samarinara/polli-ui";
import { ArrowLeft, type LucideIcon } from "lucide-react-native";
export function IconButton({
  icon: Icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      size="icon"
      variant={active ? "secondary" : "ghost"}
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={s.circle}
    >
      <Icon size={23} color={palette.green} />
    </Button>
  );
}
export function Sheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      animationType="none"
      onRequestClose={close}
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={s.page}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View style={s.header}>
            <IconButton icon={ArrowLeft} label="Back" onPress={close} />
            <Text
              variant="heading"
              accessibilityRole="header"
              style={s.subtitle}
            >
              {title}
            </Text>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.white },
  header: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 18,
  },
  title: { fontSize: 38, lineHeight: 48, flex: 1 },
  subtitle: { fontSize: 28, lineHeight: 38, flex: 1 },
  heading: { fontSize: 24, lineHeight: 34, marginTop: 18, marginBottom: 8 },
  circle: { width: 48, height: 48, borderRadius: 24 },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 24,
    paddingBottom: 40,
    gap: 18,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  spread: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { fontSize: 26, lineHeight: 34, flex: 1 },
  muted: { color: "#52665A", fontSize: 14, lineHeight: 22 },
  error: { color: "#A02B28", fontSize: 15, lineHeight: 23 },
  paragraph: { fontSize: 18, lineHeight: 28 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 20 },
  field: {
    backgroundColor: "#EDF2EA",
    borderWidth: 0,
    borderRadius: 20,
    minHeight: 52,
    fontSize: 23,
  },
  multiline: {
    minHeight: 130,
    textAlignVertical: "top",
    lineHeight: 30,
    paddingTop: 16,
  },
  dockWrap: { alignItems: "center", paddingVertical: 12 },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 40,
    backgroundColor: palette.white,
    boxShadow: "0px 3px 20px #21352D18",
  },
  recipe: {
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  badge: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: palette.yellow,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    alignSelf: "center",
    width: "88%",
    maxWidth: 712,
    marginBottom: 16,
    backgroundColor: "#EDF2EA",
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 18,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: "transparent",
    minHeight: 54,
    fontSize: 23,
  },
});
