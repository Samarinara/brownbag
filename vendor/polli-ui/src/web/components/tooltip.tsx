'use client';
import * as React from 'react';
import * as T from '@radix-ui/react-tooltip';
import { cn } from '../lib/utils';
import { MotionProvider, useMotionState, useMotionAttribute } from '../lib/motion';
export const TooltipProvider=T.Provider,TooltipTrigger=T.Trigger;
export function Tooltip({onOpenChange,...props}:React.ComponentProps<typeof T.Root>){
  const [open,change,motion]=useMotionState(props.open,props.defaultOpen ?? false);
  return <MotionProvider value={motion}><T.Root {...props} open={open} onOpenChange={next=>{change(next);onOpenChange?.(next)}}/></MotionProvider>;
}
export type TooltipContentProps = React.ComponentPropsWithoutRef<typeof T.Content> & { container?: React.ComponentProps<typeof T.Portal>['container'] };
export const TooltipContent=React.forwardRef<React.ElementRef<typeof T.Content>,TooltipContentProps>(({className,sideOffset=6,collisionPadding=8,container,forceMount,...props},ref)=><T.Portal container={container} forceMount={forceMount}><T.Content data-polli="tooltip" data-polli-motion={useMotionAttribute()} ref={ref} forceMount={forceMount} sideOffset={sideOffset} collisionPadding={collisionPadding} className={cn('polli-root z-50 max-w-[min(20rem,calc(100vw-1rem))] rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-sm',className)} {...props}/></T.Portal>); TooltipContent.displayName='TooltipContent';
