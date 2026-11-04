import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva,type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';
const styles=cva('inline-flex items-center gap-1 rounded-full border-0 px-3 py-1 text-xs font-medium',{variants:{tone:{mint:'bg-mint text-mint-foreground',coral:'bg-coral text-coral-foreground',butter:'bg-butter text-butter-foreground',sky:'bg-sky text-sky-foreground',neutral:'bg-muted text-foreground'}},defaultVariants:{tone:'mint'}});
export type BadgeProps = React.ComponentPropsWithoutRef<'span'> & VariantProps<typeof styles> & { asChild?: boolean };
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, tone, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'span';
  return <Comp data-polli="badge" ref={ref} className={cn(styles({ tone }), className)} {...props} />;
});
Badge.displayName = 'Badge';
