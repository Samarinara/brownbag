import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
export function flattenViewStyle(style: StyleProp<ViewStyle>): ViewStyle {
  return (StyleSheet.flatten(style) ?? {}) as ViewStyle;
}
