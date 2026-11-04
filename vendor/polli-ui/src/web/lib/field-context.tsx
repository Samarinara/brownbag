'use client';

import * as React from 'react';

type FieldContextValue = { id: string; descriptionId?: string; invalid: boolean };
export const FieldContext = React.createContext<FieldContextValue | undefined>(undefined);
type ControlProps = Pick<React.ComponentPropsWithoutRef<'input'>, 'id' | 'aria-describedby' | 'aria-invalid'>;

// Shared controls inherit the field's relationships, while standalone controls
// keep their native props. Explicit descriptions are retained and deduplicated.
export function useFieldControl<T extends ControlProps>(props: T) {
  const field = React.useContext(FieldContext);
  if (!field) return props;
  const describedBy = [...new Set(`${props['aria-describedby'] ?? ''} ${field.descriptionId ?? ''}`.trim().split(/\s+/).filter(Boolean))].join(' ');
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': field.invalid ? true : props['aria-invalid'],
  };
}

