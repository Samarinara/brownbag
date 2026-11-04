import * as React from "react";
import { Animated, type TextProps, type ViewProps } from "react-native";
import { Text } from "../theme";
import { useReducedMotion } from "../lib/motion";
import type { ActionKey } from "./animated-icon";
export type InkTextProps = TextProps & {
  crossedOut?: boolean;
  underlineKey?: ActionKey;
};
export const InkText: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<InkTextProps> &
    React.RefAttributes<React.ComponentRef<typeof Text>>
> = React.forwardRef<React.ComponentRef<typeof Text>, InkTextProps>(
  ({ crossedOut, underlineKey, style, ...props }, ref) => {
    const initialKey = React.useRef(underlineKey);
    return (
      <Text
        ref={ref}
        variant="input"
        style={[
          {
            textDecorationLine: crossedOut
              ? "line-through"
              : !Object.is(initialKey.current, underlineKey)
                ? "underline"
                : "none",
          },
          style,
        ]}
        {...props}
      />
    );
  },
);
InkText.displayName = "InkText";
export type InkRemovalProps = ViewProps & {
  removed: boolean;
  onExitComplete: () => void;
};
export function InkRemoval({
  removed,
  onExitComplete,
  style,
  ...props
}: InkRemovalProps) {
  const progress = React.useRef(new Animated.Value(removed ? 0 : 1)).current;
  const reduced = useReducedMotion();
  const complete = React.useRef(onExitComplete);
  complete.current = onExitComplete;
  const completed = React.useRef(false);
  React.useEffect(() => {
    if (!removed) {
      completed.current = false;
      progress.setValue(1);
      return;
    }
    const finish = () => {
      if (!completed.current) {
        completed.current = true;
        complete.current();
      }
    };
    if (reduced) {
      progress.setValue(0);
      finish();
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) finish();
    });
    return () => animation.stop();
  }, [removed, progress, reduced]);
  return (
    <Animated.View
      pointerEvents={removed ? "none" : "auto"}
      accessibilityElementsHidden={removed}
      importantForAccessibility={removed ? "no-hide-descendants" : "auto"}
      style={[{ opacity: progress }, style]}
      {...props}
    />
  );
}
