import type { StaticProps } from "../lib/types";
import * as React from "react";
import * as T from "@rn-primitives/tabs";
import { textChildren, usePolliTheme } from "../theme";
import { useControllable } from "../lib/state";
import { palette } from "../tokens";
export type TabsProps = Omit<T.RootProps, "value" | "onValueChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};
export function Tabs({
  value,
  defaultValue = "",
  onValueChange,
  ...props
}: TabsProps) {
  const [current, change] = useControllable(value, defaultValue, onValueChange);
  return <T.Root value={current} onValueChange={change} {...props} />;
}
export const TabsList: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<T.ListProps> & React.RefAttributes<T.ListRef>
> = React.forwardRef<T.ListRef, T.ListProps>(({ style, ...props }, ref) => (
  <T.List
    ref={ref}
    style={[{ flexDirection: "row", flexWrap: "wrap", gap: 8 }, style]}
    {...props}
  />
));
TabsList.displayName = "TabsList";
export type TabsTriggerProps = StaticProps<T.TriggerProps> & {
  inkTone?: "mint" | "coral" | "butter" | "sky";
};
export const TabsTrigger: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TabsTriggerProps> & React.RefAttributes<T.TriggerRef>
> = React.forwardRef<T.TriggerRef, TabsTriggerProps>(
  ({ style, children, inkTone = "butter", ...props }, ref) => {
    const { value } = T.useRootContext();
    const { colors } = usePolliTheme();
    const selected = value === props.value;
    return (
      <T.Trigger
        ref={ref}
        style={[
          {
            minHeight: 44,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: selected
              ? {
                  mint: palette.mint,
                  coral: palette.coral,
                  butter: palette.yellow,
                  sky: palette.blue,
                }[inkTone]
              : "transparent",
          },
          style,
        ]}
        {...props}
      >
        {textChildren(children, {
          color: selected ? palette.ink : colors.foreground,
        })}
      </T.Trigger>
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";
export const TabsContent: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<T.ContentProps> & React.RefAttributes<T.ContentRef>
> = React.forwardRef<T.ContentRef, T.ContentProps>(
  ({ children, style, ...props }, ref) => (
    <T.Content
      ref={ref}
      style={[{ paddingVertical: 16, gap: 12 }, style]}
      {...props}
    >
      {textChildren(children)}
    </T.Content>
  ),
);
TabsContent.displayName = "TabsContent";
