import { flattenViewStyle } from "../lib/styles";
import type { StaticProps } from "../lib/types";
import * as React from "react";
import * as M from "@rn-primitives/dropdown-menu";
import { StyleSheet } from "react-native";
import { textChildren, ui, usePolliTheme } from "../theme";
export const DropdownMenu: typeof M.Root = M.Root;
export const DropdownMenuTrigger: typeof M.Trigger = M.Trigger;
export type DropdownMenuContentProps = M.ContentProps;
export const DropdownMenuContent: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<DropdownMenuContentProps> &
    React.RefAttributes<M.ContentRef>
> = React.forwardRef<M.ContentRef, DropdownMenuContentProps>(
  ({ style, sideOffset = 6, ...props }, ref) => {
    const { colors } = usePolliTheme();
    return (
      <M.Portal>
        <M.Overlay style={StyleSheet.absoluteFill}>
          <M.Content
            ref={ref}
            sideOffset={sideOffset}
            style={flattenViewStyle([
              ui.panel,
              {
                minWidth: 180,
                padding: 6,
                gap: 2,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
              style,
            ])}
            {...props}
          />
        </M.Overlay>
      </M.Portal>
    );
  },
);
DropdownMenuContent.displayName = "DropdownMenuContent";
export const DropdownMenuItem: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<StaticProps<M.ItemProps>> &
    React.RefAttributes<M.ItemRef>
> = React.forwardRef<M.ItemRef, StaticProps<M.ItemProps>>(
  ({ style, children, disabled, ...props }, ref) => (
    <M.Item
      ref={ref}
      disabled={disabled}
      style={[
        {
          minHeight: 44,
          padding: 12,
          borderRadius: 8,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
      {...props}
    >
      {textChildren(children)}
    </M.Item>
  ),
);
DropdownMenuItem.displayName = "DropdownMenuItem";
