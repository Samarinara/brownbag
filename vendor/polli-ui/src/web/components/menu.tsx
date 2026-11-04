'use client';
import * as React from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { tabbable } from 'tabbable';
import { cn } from '../lib/utils';
import { MotionProvider, useMotionState, useMotionAttribute } from '../lib/motion';
import { ModalIsolationProvider, useModalIsolation } from '../lib/isolation';
const MenuContext = React.createContext<{ open: boolean; close: () => void; trigger: React.MutableRefObject<HTMLButtonElement | null> } | undefined>(undefined);
export function DropdownMenu({onOpenChange,modal=true,...props}:React.ComponentProps<typeof M.Root>){
  const [open,change,motion]=useMotionState(props.open,props.defaultOpen ?? false);
  const trigger=React.useRef<HTMLButtonElement | null>(null);
  const handleChange=(next:boolean)=>{change(next);onOpenChange?.(next)};
  return <MotionProvider value={motion}><ModalIsolationProvider value={open && modal}><MenuContext.Provider value={{open,close:()=>handleChange(false),trigger}}><M.Root {...props} modal={modal} open={open} onOpenChange={handleChange}/></MenuContext.Provider></ModalIsolationProvider></MotionProvider>;
}
export const DropdownMenuTrigger=React.forwardRef<React.ElementRef<typeof M.Trigger>,React.ComponentPropsWithoutRef<typeof M.Trigger>>((props,forwardedRef)=>{
  const menu=React.useContext(MenuContext);
  const ref=React.useCallback((node:HTMLButtonElement | null)=>{
    if(menu) menu.trigger.current=node;
    if(typeof forwardedRef==='function') {
      const cleanup:unknown=forwardedRef(node);
      if(typeof cleanup==='function') return ()=>{if(menu) menu.trigger.current=null;cleanup()};
    } else if(forwardedRef) forwardedRef.current=node;
  },[menu?.trigger,forwardedRef]);
  return <M.Trigger {...props} ref={ref}/>;
}); DropdownMenuTrigger.displayName='DropdownMenuTrigger';
export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof M.Content> & { container?: React.ComponentProps<typeof M.Portal>['container'] };
export const DropdownMenuContent=React.forwardRef<React.ElementRef<typeof M.Content>,DropdownMenuContentProps>(({className,sideOffset=6,collisionPadding=8,container,forceMount,onKeyDown,onCloseAutoFocus,...props},ref)=>{
  const menu=React.useContext(MenuContext);
  const direction=React.useRef<-1 | 1 | undefined>(undefined);
  React.useEffect(()=>{if(menu?.open) direction.current=undefined},[menu?.open]);
  return <M.Portal container={container} forceMount={forceMount}><M.Content data-polli="menu" data-polli-motion={useMotionAttribute()} ref={useModalIsolation(ref)} forceMount={forceMount} sideOffset={sideOffset} collisionPadding={collisionPadding} className={cn('polli-root z-50 min-w-44 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-border bg-background p-2 text-foreground shadow-lg',className)} {...props}
    onKeyDown={event=>{
      onKeyDown?.(event);
      if(event.key==='Tab' && !event.defaultPrevented && menu) {
        event.preventDefault();
        direction.current=event.shiftKey ? -1 : 1;
        const content=event.currentTarget;
        menu.close();
        queueMicrotask(()=>{if(content.isConnected && content.dataset.state==='open') direction.current=undefined});
      }
    }}
    onCloseAutoFocus={event=>{
      onCloseAutoFocus?.(event);
      const step=direction.current;
      direction.current=undefined;
      if(step && !event.defaultPrevented) {
        event.preventDefault();
        const trigger=menu?.trigger.current;
        if(trigger) {
          const candidates=tabbable(trigger.ownerDocument.body,{getShadowRoot:true}).filter(element=>!element.hasAttribute('data-radix-focus-guard') && !element.closest('[aria-hidden="true"]'));
          const next=candidates[candidates.indexOf(trigger)+step];
          (next ?? trigger).focus();
        }
      }
    }}/></M.Portal>;
}); DropdownMenuContent.displayName='DropdownMenuContent';
export const DropdownMenuItem=React.forwardRef<React.ElementRef<typeof M.Item>,React.ComponentPropsWithoutRef<typeof M.Item>>(({className,...props},ref)=><M.Item data-polli="menu-item" ref={ref} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',className)} {...props}/>); DropdownMenuItem.displayName='DropdownMenuItem';
