'use client';
import * as React from 'react';
import * as Check from '@radix-ui/react-checkbox';
import * as Toggle from '@radix-ui/react-switch';
import { Slottable } from '@radix-ui/react-slot';
import { cn } from '../lib/utils';
import { useMotionState } from '../lib/motion';
import { useFieldControl } from '../lib/field-context';
export const Checkbox=React.forwardRef<React.ElementRef<typeof Check.Root>,React.ComponentPropsWithoutRef<typeof Check.Root>>(({className,children,asChild=false,...props},ref)=><Check.Root data-polli="checkbox" asChild={asChild} ref={ref} className={cn('inline-flex size-6 shrink-0 items-center justify-center border border-border bg-transparent text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50',className)} {...useFieldControl(props)}>
  <Slottable>{asChild ? children : null}</Slottable>
  <span data-polli="checkbox-fill" aria-hidden="true" />
  <Check.Indicator forceMount data-polli="checkbox-mark">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path data-polli-stroke="check" pathLength="1" d="m5 12 4 4L19 6" />
      <path data-polli-stroke="minus" pathLength="1" d="M5 12h14" />
    </svg>
  </Check.Indicator>
</Check.Root>); Checkbox.displayName='Checkbox';
export const Switch = React.forwardRef<React.ElementRef<typeof Toggle.Root>, React.ComponentPropsWithoutRef<typeof Toggle.Root>>(
  ({ className, checked, defaultChecked = false, onCheckedChange, children, asChild = false, ...props }, ref) => {
    const [current, change, motion] = useMotionState(checked, defaultChecked);
    return <Toggle.Root data-polli="switch" asChild={asChild} ref={ref} checked={current}
      onCheckedChange={next => { change(next); onCheckedChange?.(next); }}
      className={cn('inline-flex h-7 w-12 shrink-0 items-center rounded-full border-0 bg-border p-1 data-[state=checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50', className)} {...useFieldControl(props)}>
      <Slottable>{asChild ? children : null}</Slottable>
      <Toggle.Thumb data-polli="switch-thumb" className="block size-5 rounded-full">
        <span data-polli="switch-material" data-state={current ? 'checked' : 'unchecked'}
          data-polli-motion={motion ? 'interaction' : undefined} className="block size-5 rounded-full bg-background" />
      </Toggle.Thumb>
    </Toggle.Root>;
  },
);
Switch.displayName = 'Switch';
