'use client';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';
export const buttonVariants = cva('inline-flex max-w-full items-center justify-center gap-2 rounded-full border-0 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-45 aria-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0', { variants: { variant: { default:'bg-primary text-primary-foreground hover:not-disabled:not-aria-disabled:brightness-110', secondary:'bg-mint text-mint-foreground hover:not-disabled:not-aria-disabled:brightness-95', coral:'bg-coral text-coral-foreground hover:not-disabled:not-aria-disabled:brightness-95', butter:'bg-butter text-butter-foreground hover:not-disabled:not-aria-disabled:brightness-95', sky:'bg-sky text-sky-foreground hover:not-disabled:not-aria-disabled:brightness-95', ghost:'bg-transparent text-foreground hover:not-disabled:not-aria-disabled:bg-muted', destructive:'bg-destructive text-background hover:not-disabled:not-aria-disabled:brightness-110' }, size:{ default:'min-h-11 px-5 py-2', sm:'min-h-9 px-4 py-1.5', lg:'min-h-12 px-6 py-2.5', icon:'size-11 shrink-0 p-0' } }, defaultVariants:{ variant:'default',size:'default' } });
export type ButtonProps = React.ComponentPropsWithoutRef<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const blockClick = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); };
    const blockActivation = (event: React.KeyboardEvent) => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    };
    const disabledHandlers = { 'aria-disabled': true, tabIndex: -1, onClick: blockClick, onClickCapture: blockClick, onDoubleClick: blockClick, onPointerDown: blockClick, onPointerUp: blockClick, onKeyDown: blockActivation } as const;
    // Slot merges child handlers before parent handlers, so replace the child's
    // activation handlers too when an anchor is disabled.
    const child = asChild && disabled && React.isValidElement<React.ComponentPropsWithoutRef<'button'>>(children)
      ? React.cloneElement(children, disabledHandlers)
      : children;
    const childIsButton = asChild && React.isValidElement(children) && children.type === 'button';
    return <Comp data-polli="button" ref={ref} className={cn(buttonVariants({ variant, size }), className)}
      {...props} {...(!asChild || childIsButton ? { type: type ?? 'button', disabled } : type ? { type } : {})}
      {...(asChild && disabled ? disabledHandlers : {})}>
      {child}
    </Comp>;
  },
);
Button.displayName='Button';
