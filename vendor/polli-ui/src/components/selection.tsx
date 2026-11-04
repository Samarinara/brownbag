import { flattenViewStyle } from "../lib/styles";
import type { StaticProps } from "../lib/types";
import * as React from "react";
import * as Check from "@rn-primitives/checkbox";
import * as Toggle from "@rn-primitives/switch";
import { Check as CheckIcon } from "lucide-react-native";
import { useControllable } from "../lib/state";
import { usePolliTheme } from "../theme";
export type CheckboxProps = Omit<
  StaticProps<Check.RootProps>,
  "checked" | "onCheckedChange"
> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};
export const Checkbox: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<CheckboxProps> & React.RefAttributes<Check.RootRef>
> = React.forwardRef<Check.RootRef, CheckboxProps>(
  (
    {
      checked: value,
      defaultChecked = false,
      onCheckedChange,
      style,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [checked, change] = useControllable(
      value,
      defaultChecked,
      onCheckedChange,
    );
    const { colors } = usePolliTheme();
    return (
      <Check.Root
        ref={ref}
        checked={checked}
        onCheckedChange={change}
        disabled={disabled}
        hitSlop={10}
        style={flattenViewStyle([
          {
            width: 26,
            height: 26,
            borderWidth: 1,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            borderColor: colors.border,
            backgroundColor: checked ? colors.primary : colors.background,
            opacity: disabled ? 0.45 : 1,
          },
          style,
        ])}
        {...props}
      >
        <Check.Indicator>
          <CheckIcon size={20} color={colors.primaryForeground} />
        </Check.Indicator>
      </Check.Root>
    );
  },
);
Checkbox.displayName = "Checkbox";
export type SwitchProps = Omit<
  StaticProps<Toggle.RootProps>,
  "checked" | "onCheckedChange"
> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};
export const Switch: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<SwitchProps> & React.RefAttributes<Toggle.RootRef>
> = React.forwardRef<Toggle.RootRef, SwitchProps>(
  (
    {
      checked: value,
      defaultChecked = false,
      onCheckedChange,
      style,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [checked, change] = useControllable(
      value,
      defaultChecked,
      onCheckedChange,
    );
    const { colors } = usePolliTheme();
    return (
      <Toggle.Root
        ref={ref}
        checked={checked}
        onCheckedChange={change}
        disabled={disabled}
        hitSlop={8}
        style={flattenViewStyle([
          {
            width: 48,
            height: 28,
            padding: 3,
            borderRadius: 20,
            justifyContent: "center",
            backgroundColor: checked ? colors.primary : colors.border,
            opacity: disabled ? 0.45 : 1,
          },
          style,
        ])}
        {...props}
      >
        <Toggle.Thumb
          style={{
            width: 22,
            height: 22,
            borderRadius: 12,
            backgroundColor: colors.background,
            transform: [{ translateX: checked ? 20 : 0 }],
          }}
        />
      </Toggle.Root>
    );
  },
);
Switch.displayName = "Switch";
