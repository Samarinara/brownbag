import { flattenViewStyle } from "../lib/styles";
import * as React from "react";
import {
  TextInput,
  View,
  StyleSheet,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from "react-native";
import * as Select from "@rn-primitives/select";
import { ChevronDown } from "lucide-react-native";
import { Text, ui, usePolliTheme } from "../theme";

const FieldContext = React.createContext<{
  id: string;
  label: string;
  invalid: boolean;
  description?: string;
  error?: string;
} | null>(null);
export type FieldProps = ViewProps & {
  label: string;
  description?: string;
  error?: string;
  id?: string;
};
export const Field: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<FieldProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, FieldProps>(
  (
    { label, description, error, id: suppliedId, children, style, ...props },
    ref,
  ) => {
    const generated = React.useId();
    const id = suppliedId ?? generated;
    const { colors } = usePolliTheme();
    return (
      <FieldContext.Provider
        value={{ id, label, invalid: !!error, description, error }}
      >
        <View ref={ref} style={[{ gap: 8 }, style]} {...props}>
          <Label nativeID={`${id}-label`}>{label}</Label>
          {children}
          {description ? (
            <Text
              nativeID={`${id}-description`}
              style={{ color: colors.mutedForeground, fontSize: 14 }}
            >
              {description}
            </Text>
          ) : null}
          {error ? (
            <Text
              nativeID={`${id}-error`}
              accessibilityRole="alert"
              style={{ color: colors.destructive, fontSize: 14 }}
            >
              {error}
            </Text>
          ) : null}
        </View>
      </FieldContext.Provider>
    );
  },
);
Field.displayName = "Field";
export const Label: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TextProps> &
    React.RefAttributes<React.ComponentRef<typeof Text>>
> = React.forwardRef<React.ComponentRef<typeof Text>, TextProps>(
  ({ style, ...props }, ref) => (
    <Text
      ref={ref}
      variant="heading"
      style={[{ fontSize: 16 }, style]}
      {...props}
    />
  ),
);
Label.displayName = "Label";
export const Input: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TextInputProps> &
    React.RefAttributes<React.ComponentRef<typeof TextInput>>
> = React.forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps>(
  ({ style, accessibilityLabel, ...props }, ref) => {
    const field = React.useContext(FieldContext);
    const { colors, fonts } = usePolliTheme();
    return (
      <TextInput
        ref={ref}
        nativeID={field?.id}
        accessibilityLabelledBy={field ? `${field.id}-label` : undefined}
        aria-labelledby={field ? `${field.id}-label` : undefined}
        aria-describedby={
          field
            ? [
                field.description && `${field.id}-description`,
                field.error && `${field.id}-error`,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            : undefined
        }
        aria-invalid={field?.invalid || undefined}
        accessibilityLabel={accessibilityLabel ?? field?.label}
        placeholderTextColor={colors.mutedForeground}
        style={[
          ui.control,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: field?.invalid ? colors.destructive : colors.border,
            fontFamily: fonts.input,
            fontSize: 20,
          },
          style,
        ]}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
export const Textarea: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TextInputProps> &
    React.RefAttributes<React.ComponentRef<typeof TextInput>>
> = React.forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps>(
  ({ style, ...props }, ref) => (
    <Input
      ref={ref}
      multiline
      textAlignVertical="top"
      style={[{ minHeight: 120 }, style]}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
export type SelectOption = { value: string; label: string; disabled?: boolean };
export type NativeSelectProps = Omit<
  Select.RootProps,
  "value" | "defaultValue" | "onValueChange" | "children"
> & {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | undefined) => void;
  placeholder?: string;
  accessibilityLabel?: string;
};
/** Options are data rather than HTML option elements on every platform. */
export function NativeSelect({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Choose an option",
  accessibilityLabel,
  style,
  ...props
}: NativeSelectProps) {
  const field = React.useContext(FieldContext);
  const { colors } = usePolliTheme();
  return (
    <Select.Root
      value={
        value === undefined
          ? undefined
          : options.find((option) => option.value === value)
      }
      defaultValue={options.find((option) => option.value === defaultValue)}
      onValueChange={(option) => onValueChange?.(option?.value)}
      {...props}
    >
      <Select.Trigger
        accessibilityLabel={accessibilityLabel ?? field?.label}
        aria-labelledby={field ? `${field.id}-label` : undefined}
        accessibilityLabelledBy={field ? `${field.id}-label` : undefined}
        style={[
          ui.control,
          ui.row,
          {
            justifyContent: "space-between",
            borderColor: colors.border,
            backgroundColor: colors.background,
          },
          style,
        ]}
      >
        <Select.Value
          placeholder={placeholder}
          style={{ color: colors.foreground, fontSize: 18 }}
        />
        <ChevronDown size={18} color={colors.foreground} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Overlay style={StyleSheet.absoluteFill}>
          <Select.Content
            position="popper"
            sideOffset={6}
            style={flattenViewStyle([
              ui.panel,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                minWidth: 200,
                maxWidth: 340,
              },
            ])}
          >
            {options.map((option) => (
              <Select.Item
                key={option.value}
                {...option}
                style={{ minHeight: 44, padding: 10 }}
              >
                <Select.ItemText
                  style={{
                    color: colors.foreground,
                    opacity: option.disabled ? 0.45 : 1,
                  }}
                />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Overlay>
      </Select.Portal>
    </Select.Root>
  );
}
