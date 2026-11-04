'use client';
import * as React from 'react';
import * as T from '@radix-ui/react-tabs';
import { cn } from '../lib/utils';
import { MotionProvider, useMotionState, useMotionAttribute } from '../lib/motion';

export const Tabs = React.forwardRef<React.ElementRef<typeof T.Root>, React.ComponentPropsWithoutRef<typeof T.Root>>(
  ({ onValueChange, ...props }, ref) => {
    const [value, change, motion] = useMotionState(props.value, props.defaultValue ?? '');
    return <MotionProvider value={motion}>
      <T.Root {...props} ref={ref} value={value} onValueChange={next => { change(next); onValueChange?.(next); }} />
    </MotionProvider>;
  },
);
Tabs.displayName = 'Tabs';

export const TabsList = React.forwardRef<React.ElementRef<typeof T.List>, React.ComponentPropsWithoutRef<typeof T.List>>(
  ({ className, ...props }, ref) =>
    <T.List data-polli="tabs-list" ref={ref}
      className={cn('flex w-fit max-w-full items-center gap-4 overflow-x-auto', className)}
      {...props} />,
);
TabsList.displayName = 'TabsList';

export type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof T.Trigger> & {
  /** Colour used by the selected tab’s small underline. Defaults to butter. */
  inkTone?: 'green' | 'butter' | 'coral' | 'sky' | 'mint';
};
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof T.Trigger>, TabsTriggerProps>(
  ({ className, inkTone = 'butter', ...props }, ref) =>
    <T.Trigger data-polli="tabs-trigger" data-polli-ink-tone={inkTone} ref={ref}
      className={cn('relative shrink-0 border-0 bg-transparent px-1 py-2 text-sm font-medium text-muted-foreground data-[state=active]:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50', className)}
      {...props} />,
);
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<React.ElementRef<typeof T.Content>, React.ComponentPropsWithoutRef<typeof T.Content>>(
  ({ className, ...props }, ref) =>
    <T.Content data-polli="tabs-content" data-polli-motion={useMotionAttribute()} ref={ref}
      className={cn('mt-5 focus:outline-none', className)} {...props} />,
);
TabsContent.displayName = 'TabsContent';
