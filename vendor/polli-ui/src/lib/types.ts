import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
export type StaticProps<P> = Omit<P, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

// RN 0.88's generated flatten types retain array/null unions in their result.
// The runtime flattens those values into a style object on every platform.
