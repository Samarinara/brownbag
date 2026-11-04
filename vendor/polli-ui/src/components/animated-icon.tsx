import * as React from "react";
import { Animated, type ViewProps } from "react-native";
import { Copy, Pencil, Bookmark, Bell, Check } from "lucide-react-native";
import { useActionAnimation } from "../lib/motion";
import { usePolliTheme } from "../theme";
export type AnimatedIconName =
  | "copy"
  | "pencil"
  | "bookmark"
  | "bell"
  | "check";
export type ActionKey = string | number | boolean;
export type AnimatedIconProps = ViewProps & {
  name: AnimatedIconName;
  actionKey?: ActionKey;
  size?: number;
  color?: string;
};
const icons = {
  copy: Copy,
  pencil: Pencil,
  bookmark: Bookmark,
  bell: Bell,
  check: Check,
};
export const AnimatedIcon: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<AnimatedIconProps> &
    React.RefAttributes<React.ComponentRef<typeof Animated.View>>
> = React.forwardRef<
  React.ComponentRef<typeof Animated.View>,
  AnimatedIconProps
>(({ name, actionKey, size = 20, color, style, ...props }, ref) => {
  const progress = useActionAnimation(actionKey);
  const { colors } = usePolliTheme();
  const Icon = icons[name];
  return (
    <Animated.View
      ref={ref}
      accessible={false}
      style={[
        {
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [1, 1.15, 1],
              }),
            },
          ],
        },
        style,
      ]}
      {...props}
    >
      <Icon size={size} color={color ?? colors.foreground} />
    </Animated.View>
  );
});
AnimatedIcon.displayName = "AnimatedIcon";
