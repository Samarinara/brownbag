import * as React from "react";
import {
  Platform,
  StyleSheet,
  Text as NativeText,
  useColorScheme,
  View,
  type TextProps,
  type ViewProps,
} from "react-native";
import { PortalHost } from "@rn-primitives/portal";
import { palette } from "./tokens";

export const themes = {
  light: {
    background: palette.white,
    foreground: palette.ink,
    primary: palette.green,
    primaryForeground: palette.white,
    muted: "#EDF2EA",
    mutedForeground: "#52665A",
    border: "#829584",
    destructive: "#A02B28",
  },
  dark: {
    background: "#17251E",
    foreground: palette.white,
    primary: "#A5D5AD",
    primaryForeground: "#17251E",
    muted: "#26392D",
    mutedForeground: "#B3C5B8",
    border: "#809989",
    destructive: "#FFA6A0",
  },
};
export type PolliTheme = { [K in keyof typeof themes.light]: string };
export type PolliFonts = { body: string; heading: string; input: string };
const defaultFonts: PolliFonts = {
  body: Platform.OS === "ios" ? "System" : "sans-serif",
  heading: Platform.OS === "ios" ? "Georgia" : "serif",
  input: Platform.OS === "ios" ? "System" : "sans-serif",
};
const ThemeContext = React.createContext<{
  colors: PolliTheme;
  fonts: PolliFonts;
}>({ colors: themes.light, fonts: defaultFonts });
export function usePolliTheme() {
  return React.useContext(ThemeContext);
}
export type PolliProviderProps = ViewProps & {
  mode?: "light" | "dark" | "system";
  fonts?: Partial<PolliFonts>;
  theme?: Partial<PolliTheme>;
};
/** Mount once at the app root, outside navigation, so native portals cover the app. */
export function PolliProvider({
  mode = "system",
  fonts,
  theme,
  style,
  children,
  ...props
}: PolliProviderProps) {
  const system = useColorScheme();
  const colors = React.useMemo(
    () => ({
      ...themes[mode === "system" ? (system ?? "light") : mode],
      ...theme,
    }),
    [mode, system, theme],
  );
  const value = React.useMemo(
    () => ({ colors, fonts: { ...defaultFonts, ...fonts } }),
    [colors, fonts],
  );
  return (
    <ThemeContext.Provider value={value}>
      <View
        style={[{ flex: 1, backgroundColor: colors.background }, style]}
        {...props}
      >
        {children}
        <PortalHost />
      </View>
    </ThemeContext.Provider>
  );
}
export const Text: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<
    TextProps & { variant?: "body" | "heading" | "input" }
  > &
    React.RefAttributes<React.ComponentRef<typeof NativeText>>
> = React.forwardRef<
  React.ComponentRef<typeof NativeText>,
  TextProps & { variant?: "body" | "heading" | "input" }
>(({ variant = "body", style, ...props }, ref) => {
  const { colors, fonts } = usePolliTheme();
  return (
    <NativeText
      ref={ref}
      style={[
        {
          color: colors.foreground,
          fontFamily: fonts[variant],
          fontSize: variant === "heading" ? 24 : 16,
        },
        style,
      ]}
      {...props}
    />
  );
});
Text.displayName = "Text";
/** React Native requires strings to be inside Text, including button labels. */
export function textChildren(
  children: React.ReactNode,
  style?: TextProps["style"],
): React.ReactNode {
  return React.Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <Text style={style}>{child}</Text>
    ) : (
      child
    ),
  );
}
export const ui = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  control: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  panel: { borderRadius: 16, padding: 20, gap: 12, borderWidth: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#00000066",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
});
