import * as React from "react";
import * as D from "@rn-primitives/dialog";
import { ScrollView, StyleSheet, View } from "react-native";
import { X } from "lucide-react-native";
import { textChildren, ui, usePolliTheme } from "../theme";
export const Dialog: typeof D.Root = D.Root;
export const DialogTrigger: typeof D.Trigger = D.Trigger;
export const DialogClose: typeof D.Close = D.Close;
export const DialogTitle: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<D.TitleProps> & React.RefAttributes<D.TitleRef>
> = React.forwardRef<D.TitleRef, D.TitleProps>(({ style, ...props }, ref) => {
  const { colors, fonts } = usePolliTheme();
  return (
    <D.Title
      ref={ref}
      style={[
        {
          color: colors.foreground,
          fontFamily: fonts.heading,
          fontSize: 24,
          fontWeight: "600",
        },
        style,
      ]}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";
export const DialogDescription: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<D.DescriptionProps> &
    React.RefAttributes<D.DescriptionRef>
> = React.forwardRef<D.DescriptionRef, D.DescriptionProps>(
  ({ style, ...props }, ref) => {
    const { colors, fonts } = usePolliTheme();
    return (
      <D.Description
        ref={ref}
        style={[
          {
            color: colors.mutedForeground,
            fontFamily: fonts.body,
            fontSize: 16,
          },
          style,
        ]}
        {...props}
      />
    );
  },
);
DialogDescription.displayName = "DialogDescription";
export type DialogContentProps = D.ContentProps & {
  showCloseButton?: boolean;
  closeLabel?: string;
};
export const DialogContent: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<DialogContentProps> & React.RefAttributes<D.ContentRef>
> = React.forwardRef<D.ContentRef, DialogContentProps>(
  (
    {
      style,
      children,
      showCloseButton = true,
      closeLabel = "Close dialog",
      ...props
    },
    ref,
  ) => {
    const { colors } = usePolliTheme();
    const { onOpenChange } = D.useRootContext();
    return (
      <D.Portal>
        <View
          pointerEvents="box-none"
          style={[
            StyleSheet.absoluteFill,
            { justifyContent: "center", alignItems: "center", padding: 24 },
          ]}
        >
          <D.Overlay
            style={[StyleSheet.absoluteFill, { backgroundColor: "#00000066" }]}
            onPress={() => onOpenChange(false)}
          />
          <D.Content
            ref={ref}
            style={[
              ui.panel,
              {
                width: "100%",
                maxWidth: 520,
                maxHeight: "90%",
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
              style,
            ]}
            {...props}
          >
            <ScrollView
              contentContainerStyle={{ gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {textChildren(children)}
            </ScrollView>
            {showCloseButton ? (
              <D.Close
                accessibilityLabel={closeLabel}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignSelf: "flex-end",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={20} color={colors.foreground} />
              </D.Close>
            ) : null}
          </D.Content>
        </View>
      </D.Portal>
    );
  },
);
DialogContent.displayName = "DialogContent";
