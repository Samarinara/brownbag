import * as React from "react";
import { View, type ViewProps } from "react-native";
import { palette } from "../tokens";
import { textChildren } from "../theme";
export type BadgeProps = ViewProps & {
  tone?: "mint" | "coral" | "butter" | "sky";
};
export const Badge: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<BadgeProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, BadgeProps>(
  ({ tone = "mint", style, children, ...props }, ref) => (
    <View
      ref={ref}
      style={[
        {
          alignSelf: "flex-start",
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 4,
          backgroundColor: {
            mint: palette.mint,
            coral: palette.coral,
            butter: palette.yellow,
            sky: palette.blue,
          }[tone],
        },
        style,
      ]}
      {...props}
    >
      {textChildren(children, { color: palette.ink, fontSize: 13 })}
    </View>
  ),
);
Badge.displayName = "Badge";
