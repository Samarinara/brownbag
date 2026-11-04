'use client';
import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { Slottable } from '@radix-ui/react-slot';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MotionProvider, useMotionState, useMotionAttribute } from '../lib/motion';
import { ModalIsolationProvider, useModalIsolation } from '../lib/isolation';
export function Dialog({onOpenChange,modal=true,...props}:React.ComponentProps<typeof D.Root>){
  const [open,change,motion]=useMotionState(props.open,props.defaultOpen ?? false);
  return <MotionProvider value={motion}><ModalIsolationProvider value={open && modal}><D.Root {...props} modal={modal} open={open} onOpenChange={next=>{change(next);onOpenChange?.(next)}}/></ModalIsolationProvider></MotionProvider>;
}
export const DialogTrigger=D.Trigger,DialogClose=D.Close;
export const DialogTitle=React.forwardRef<React.ElementRef<typeof D.Title>,React.ComponentPropsWithoutRef<typeof D.Title>>(({className,...props},ref)=><D.Title ref={ref} className={cn('m-0 text-2xl font-semibold tracking-tight',className)} {...props}/>); DialogTitle.displayName='DialogTitle';
export const DialogDescription=React.forwardRef<React.ElementRef<typeof D.Description>,React.ComponentPropsWithoutRef<typeof D.Description>>(({className,...props},ref)=><D.Description ref={ref} className={cn('text-sm text-muted-foreground',className)} {...props}/>); DialogDescription.displayName='DialogDescription';
export type DialogContentProps = React.ComponentPropsWithoutRef<typeof D.Content> & {
  showCloseButton?: boolean;
  closeLabel?: string;
  container?: React.ComponentProps<typeof D.Portal>['container'];
};
export const DialogContent=React.forwardRef<React.ElementRef<typeof D.Content>,DialogContentProps>(({className,children,showCloseButton=true,closeLabel='Close dialog',container,forceMount,...props},ref)=>{
  const motion=useMotionAttribute();
  const contentRef=useModalIsolation(ref);
  return <D.Portal container={container} forceMount={forceMount}><D.Overlay forceMount={forceMount} data-polli="dialog-overlay" data-polli-motion={motion} className="fixed inset-0 z-40 bg-black/30"/><D.Content data-polli="dialog" data-polli-motion={motion} data-polli-close-button={showCloseButton || undefined} forceMount={forceMount} ref={contentRef} className={cn('polli-root fixed left-1/2 top-1/2 z-50 flex flex-col max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-xl border border-border bg-background p-8 text-foreground shadow-xl',className)} {...props}><Slottable>{children}</Slottable>{showCloseButton ? <D.Close data-polli="dialog-close" aria-label={closeLabel} className="sticky -top-5 order-first -mt-5 -me-5 -mb-10 self-end shrink-0 z-10 inline-flex size-11 items-center justify-center rounded-full border-0 bg-background p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><X size={18} aria-hidden="true"/></D.Close> : null}</D.Content></D.Portal>;
}); DialogContent.displayName='DialogContent';
