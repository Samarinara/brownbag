// Brownbag adapters preserve native form defaults and existing layout classes.
// Implementations and interaction styles remain owned by Polli UI.
import { forwardRef } from 'react';
import { Button as PolliButton, type ButtonProps } from '@samarinara/polli-ui/components/button';
export {
  Input,
  Textarea,
  NativeSelect as Select,
  Label,
} from '@samarinara/polli-ui/components/field';
export { Checkbox } from '@samarinara/polli-ui/components/selection';
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant, size, type = 'submit', ...props }, ref) => {
    const quiet = /icon-button|text-button|back|menu|toggle|theme|nav|day-heading|date-title/.test(
      className,
    );
    const tone =
      variant ??
      (className.includes('danger')
        ? 'destructive'
        : quiet
          ? 'ghost'
          : className.includes('secondary')
            ? 'secondary'
            : 'default');
    return (
      <PolliButton
        ref={ref}
        type={type}
        className={className}
        variant={tone}
        size={size ?? (className.includes('icon-button') ? 'icon' : 'default')}
        {...props}
      />
    );
  },
);
Button.displayName = 'BrownbagButton';
