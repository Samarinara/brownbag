import * as React from "react";
import { View, Image, type ViewProps } from "react-native";
import { Text, textChildren, usePolliTheme } from "../theme";
import { palette } from "../tokens";
export type SurfaceProps = ViewProps;
export const Surface: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<SurfaceProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, SurfaceProps>(
  ({ style, ...props }, ref) => {
    const { colors } = usePolliTheme();
    return (
      <View
        ref={ref}
        style={[
          {
            minWidth: 0,
            borderRadius: 16,
            padding: 24,
            gap: 12,
            backgroundColor: colors.muted,
          },
          style,
        ]}
        {...props}
      />
    );
  },
);
Surface.displayName = "Surface";
export const Separator: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<ViewProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, ViewProps>(
  ({ style, ...props }, ref) => {
    const { colors } = usePolliTheme();
    return (
      <View
        ref={ref}
        accessibilityRole="separator"
        style={[
          { height: 1, backgroundColor: colors.border, marginVertical: 16 },
          style,
        ]}
        {...props}
      />
    );
  },
);
Separator.displayName = "Separator";
export const Skeleton: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<ViewProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, ViewProps>(
  ({ style, ...props }, ref) => {
    const { colors } = usePolliTheme();
    return (
      <View
        ref={ref}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          { height: 16, borderRadius: 999, backgroundColor: colors.muted },
          style,
        ]}
        {...props}
      />
    );
  },
);
Skeleton.displayName = "Skeleton";
export type AvatarProps = ViewProps & { name: string; src?: string };
export const Avatar: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<AvatarProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, AvatarProps>(
  ({ name, src, style, ...props }, ref) => {
    const [failed, setFailed] = React.useState<string>();
    const initials =
      name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => Array.from(part)[0])
        .join("")
        .toLocaleUpperCase() || "?";
    return (
      <View
        ref={ref}
        accessibilityRole="image"
        accessibilityLabel={name.trim() || "Unknown person"}
        style={[
          {
            width: 44,
            height: 44,
            borderRadius: 22,
            overflow: "hidden",
            backgroundColor: palette.mint,
            alignItems: "center",
            justifyContent: "center",
          },
          style,
        ]}
        {...props}
      >
        {src && failed !== src ? (
          <Image
            key={src}
            source={{ uri: src }}
            style={{ width: "100%", height: "100%" }}
            onError={() => setFailed(src)}
            accessible={false}
          />
        ) : (
          <Text style={{ color: palette.ink }}>{initials}</Text>
        )}
      </View>
    );
  },
);
Avatar.displayName = "Avatar";
export type EmptyStateProps = ViewProps & {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
};
export const EmptyState: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<EmptyStateProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, EmptyStateProps>(
  ({ title, description, action, icon, style, ...props }, ref) => (
    <View
      ref={ref}
      style={[{ alignItems: "center", paddingVertical: 40, gap: 12 }, style]}
      {...props}
    >
      {icon}
      <Text variant="heading">{title}</Text>
      <Text style={{ textAlign: "center" }}>{description}</Text>
      {action}
    </View>
  ),
);
EmptyState.displayName = "EmptyState";
export type ListRowProps = ViewProps & {
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
};
export const ListRow: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<ListRowProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, ListRowProps>(
  (
    { leading, title, description, trailing, style, children, ...props },
    ref,
  ) => (
    <View
      ref={ref}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          paddingVertical: 16,
        },
        style,
      ]}
      {...props}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 20 }}>{title}</Text>
        {description != null ? (
          <Text style={{ fontSize: 14 }}>{description}</Text>
        ) : null}
        {children}
      </View>
      {trailing}
    </View>
  ),
);
ListRow.displayName = "ListRow";
export type AlertProps = ViewProps & { title: string };
export const Alert: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<AlertProps> &
    React.RefAttributes<React.ComponentRef<typeof View>>
> = React.forwardRef<React.ComponentRef<typeof View>, AlertProps>(
  ({ title, children, style, ...props }, ref) => (
    <View
      ref={ref}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        {
          borderRadius: 12,
          padding: 16,
          gap: 8,
          backgroundColor: palette.mint,
        },
        style,
      ]}
      {...props}
    >
      <Text style={{ fontWeight: "600", color: palette.ink }}>{title}</Text>
      {textChildren(children, { color: palette.ink })}
    </View>
  ),
);
Alert.displayName = "Alert";
