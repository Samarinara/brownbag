// Brownbag adapters preserve native form defaults and existing layout classes.
// Implementations and interaction styles remain owned by Polli UI.
import { forwardRef, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@samarinara/polli-ui/components/accordion';
export { Tabs, TabsList, TabsTrigger, TabsContent } from '@samarinara/polli-ui/components/tabs';
export { Badge } from '@samarinara/polli-ui/components/badge';
export {
  Surface,
  ListRow,
  EmptyState,
  Avatar,
  Skeleton,
} from '@samarinara/polli-ui/components/layout';

// Keep collapsed editor fields mounted so recovery, validation and form data
// behave as before; Radix owns disclosure keyboard and ARIA behavior.
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className = '',
  label,
  populated,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  label?: string;
  populated?: boolean;
}) {
  const [value, setValue] = useState(defaultOpen ? 'content' : '');
  return (
    <Accordion
      type="single"
      collapsible
      value={value}
      onValueChange={setValue}
      className="disclosure-root"
    >
      <AccordionItem
        data-polli="accordion-item"
        value="content"
        className={className}
        data-populated={populated || undefined}
      >
        <AccordionTrigger aria-label={label}>{title}</AccordionTrigger>
        <AccordionContent forceMount hidden={!value}>
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
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
