import type { StaticProps } from "../lib/types";
import * as React from "react";
import * as A from "@rn-primitives/accordion";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { textChildren, ui, usePolliTheme } from "../theme";
export const Accordion: typeof A.Root = A.Root;
export const AccordionItem: typeof A.Item = A.Item;
export const AccordionTrigger: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<StaticProps<A.TriggerProps>> &
    React.RefAttributes<A.TriggerRef>
> = React.forwardRef<A.TriggerRef, StaticProps<A.TriggerProps>>(
  ({ style, children, ...props }, ref) => {
    const { colors } = usePolliTheme();
    const { isExpanded } = A.useItemContext();
    const Icon = isExpanded ? ChevronUp : ChevronDown;
    return (
      <A.Header>
        <A.Trigger
          ref={ref}
          style={[
            ui.row,
            {
              minHeight: 44,
              paddingVertical: 14,
              justifyContent: "space-between",
            },
            style,
          ]}
          {...props}
        >
          {textChildren(children)}
          <Icon size={18} color={colors.foreground} />
        </A.Trigger>
      </A.Header>
    );
  },
);
AccordionTrigger.displayName = "AccordionTrigger";
export const AccordionContent: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<A.ContentProps> & React.RefAttributes<A.ContentRef>
> = React.forwardRef<A.ContentRef, A.ContentProps>(
  ({ style, children, ...props }, ref) => (
    <A.Content
      ref={ref}
      style={[{ paddingBottom: 16, gap: 8 }, style]}
      {...props}
    >
      {textChildren(children)}
    </A.Content>
  ),
);
AccordionContent.displayName = "AccordionContent";
