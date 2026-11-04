'use client';
import * as React from 'react';
import * as A from '@radix-ui/react-accordion';
import { Slottable } from '@radix-ui/react-slot';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { MotionProvider, useMotionState, useMotionAttribute } from '../lib/motion';
export const Accordion=React.forwardRef<React.ElementRef<typeof A.Root>,React.ComponentPropsWithoutRef<typeof A.Root>>((props,ref)=>{
  const [value,change,motion]=useMotionState<string | string[]>(props.value,props.defaultValue ?? (props.type==='single' ? '' : []));
  return <MotionProvider value={motion}>{props.type==='single'
    ? <A.Root {...props} ref={ref} value={value as string} onValueChange={(next:string)=>{change(next);props.onValueChange?.(next)}}/>
    : <A.Root {...props} ref={ref} value={value as string[]} onValueChange={(next:string[])=>{change(next);props.onValueChange?.(next)}}/>
  }</MotionProvider>;
}); Accordion.displayName='Accordion';
export const AccordionItem=A.Item;
export const AccordionTrigger=React.forwardRef<React.ElementRef<typeof A.Trigger>,React.ComponentPropsWithoutRef<typeof A.Trigger>>(({className,children,...props},ref)=><A.Header className="m-0"><A.Trigger data-polli="accordion-trigger" ref={ref} className={cn('group flex w-full items-center justify-between gap-4 rounded-lg border-0 bg-transparent py-4 text-left text-sm font-medium text-foreground enabled:hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45',className)} {...props}><Slottable>{children}</Slottable><ChevronDown size={16} data-polli="accordion-chevron" aria-hidden="true"/></A.Trigger></A.Header>); AccordionTrigger.displayName='AccordionTrigger';
export const AccordionContent=React.forwardRef<React.ElementRef<typeof A.Content>,React.ComponentPropsWithoutRef<typeof A.Content>>(({className,children,...props},ref)=><A.Content data-polli="accordion-content" data-polli-motion={useMotionAttribute()} ref={ref} className={cn('overflow-hidden text-sm text-muted-foreground',props.asChild && 'pb-4',className)} {...props}>{props.asChild ? children : <div className="pb-4">{children}</div>}</A.Content>); AccordionContent.displayName='AccordionContent';
