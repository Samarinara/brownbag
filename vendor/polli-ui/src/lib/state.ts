import * as React from "react";
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value === undefined ? internal : value;
  const change = (next: T) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };
  return [current, change] as const;
}
