import { flattenViewStyle } from "../lib/styles";
import * as React from "react";
import * as T from "@rn-primitives/tooltip";
import { StyleSheet } from "react-native";
import { textChildren, usePolliTheme } from "../theme";
/** Kept for composition with web apps. RN Primitives owns per-tooltip delays. */
export function TooltipProvider({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}
export const Tooltip: typeof T.Root = T.Root;
export const TooltipTrigger: typeof T.Trigger = T.Trigger;
export type TooltipContentProps = T.ContentProps;
export const TooltipContent: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TooltipContentProps> & React.RefAttributes<T.ContentRef>
> = React.forwardRef<T.ContentRef, TooltipContentProps>(
  ({ children, style, sideOffset = 6, ...props }, ref) => {
    const { colors } = usePolliTheme();
    return (
      <T.Portal>
        <T.Overlay style={StyleSheet.absoluteFill}>
          <T.Content
            ref={ref}
            sideOffset={sideOffset}
            style={flattenViewStyle([
              {
                maxWidth: 300,
                padding: 12,
                borderRadius: 8,
                backgroundColor: colors.foreground,
              },
              style,
            ])}
            {...props}
          >
            {textChildren(children, { color: colors.background, fontSize: 14 })}
          </T.Content>
        </T.Overlay>
      </T.Portal>
    );
  },
);
TooltipContent.displayName = "TooltipContent";
