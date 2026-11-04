import * as React from "react";
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { Pressable as SlotPressable } from "@rn-primitives/slot";
import { palette } from "../tokens";
import { textChildren, usePolliTheme } from "../theme";
export type ButtonProps = PressableProps & {
  variant?:
    | "default"
    | "secondary"
    | "coral"
    | "butter"
    | "sky"
    | "ghost"
    | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  textStyle?: StyleProp<TextStyle>;
  asChild?: boolean;
};
export const Button: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<ButtonProps> &
    React.RefAttributes<React.ComponentRef<typeof Pressable>>
> = React.forwardRef<React.ComponentRef<typeof Pressable>, ButtonProps>(
  (
    {
      variant = "default",
      size = "default",
      style,
      textStyle,
      children,
      disabled,
      asChild,
      ...props
    },
    ref,
  ) => {
    const { colors } = usePolliTheme();
    const backgroundColor = {
      default: colors.primary,
      secondary: palette.mint,
      coral: palette.coral,
      butter: palette.yellow,
      sky: palette.blue,
      ghost: "transparent",
      destructive: colors.destructive,
    }[variant];
    const color =
      variant === "default"
        ? colors.primaryForeground
        : variant === "destructive"
          ? colors.background
          : variant === "ghost"
            ? colors.foreground
            : palette.ink;
    const Comp = asChild ? SlotPressable : Pressable;
    return (
      <Comp
        ref={ref}
        accessibilityRole="button"
        disabled={disabled}
        accessibilityState={{ disabled: !!disabled }}
        {...props}
        style={(state) => [
          {
            minHeight: size === "lg" ? 48 : 44,
            minWidth: 44,
            borderRadius: 999,
            paddingHorizontal: size === "icon" ? 0 : size === "sm" ? 16 : 20,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor,
            opacity: disabled ? 0.45 : state.pressed ? 0.75 : 1,
          },
          typeof style === "function" ? style(state) : style,
        ]}
      >
        {asChild
          ? React.Children.only(children as React.ReactNode)
          : (state: PressableStateCallbackType) =>
              textChildren(
                typeof children === "function" ? children(state) : children,
                [{ color, fontWeight: "600" }, textStyle],
              )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
