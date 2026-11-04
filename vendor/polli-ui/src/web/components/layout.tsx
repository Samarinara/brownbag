'use client';

import * as React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cn } from '../lib/utils';

export type SurfaceProps = React.ComponentPropsWithoutRef<'div'> & { asChild?: boolean };
export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return <Comp data-polli="surface" ref={ref} className={cn('min-w-0 rounded-xl bg-muted p-6', className)} {...props} />;
});
Surface.displayName = 'Surface';

export const Separator = React.forwardRef<HTMLHRElement, React.ComponentPropsWithoutRef<'hr'>>(({ className, ...props }, ref) =>
  <hr data-polli="separator" ref={ref} className={cn('my-6 border-0 border-t border-border', className)} {...props} />,
);
Separator.displayName = 'Separator';

export const Skeleton = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(({ className, ...props }, ref) =>
  <div data-polli="skeleton" ref={ref} aria-hidden="true" className={cn('h-4 rounded-full bg-muted', className)} {...props} />,
);
Skeleton.displayName = 'Skeleton';

export type AvatarProps = React.ComponentPropsWithoutRef<'span'> & { name: string; src?: string };
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(({ name, src, className, ...props }, ref) => {
  const [image, setImage] = React.useState({ src, failed: false });
  if (image.src !== src) setImage({ src, failed: false });
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || '?';
  return <span data-polli="avatar" ref={ref} role="img" aria-label={name.trim() || 'Unknown person'} className={cn('inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-mint text-sm font-medium text-mint-foreground', className)} {...props}>
    {src && !image.failed ? <img key={src} src={src} alt="" onError={() => setImage({ src, failed: true })} className="size-full object-cover" /> : initials}
  </span>;
});
Avatar.displayName = 'Avatar';

export type EmptyStateProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> & {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
};
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(({ title, description, action, icon, className, ...props }, ref) =>
  <div data-polli="empty-state" ref={ref} className={cn('grid min-w-0 justify-items-center gap-3 py-12 text-center', className)} {...props}>
    {icon ? <span aria-hidden="true">{icon}</span> : null}
    <h3 className="m-0 text-lg font-semibold">{title}</h3>
    <p className="m-0 max-w-sm text-sm text-muted-foreground">{description}</p>
    {action}
  </div>,
);
EmptyState.displayName = 'EmptyState';

export type ListRowProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> & {
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  asChild?: boolean;
};
export const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(({ leading, title, description, trailing, className, children, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return <Comp data-polli="list-row" ref={ref} className={cn('flex min-w-0 items-center gap-4 rounded-lg py-4', className)} {...props}>
    <Slottable>{children}</Slottable>
    {leading}
    <div className="min-w-0 flex-1">
      <div data-polli="list-title" className="text-xl leading-normal font-medium">{title}</div>
      {description !== undefined && description !== null ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
    </div>
    {trailing}
  </Comp>;
});
ListRow.displayName = 'ListRow';

export type AlertProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> & { title: string };
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ title, children, className, ...props }, ref) =>
  <div data-polli="alert" ref={ref} role="status" aria-atomic="true" className={cn('min-w-0 rounded-lg bg-mint p-4 text-mint-foreground', className)} {...props}>
    <div data-polli="alert-title" className="text-sm font-medium">{title}</div>
    <div className="mt-1 text-sm">{children}</div>
  </div>,
);
Alert.displayName = 'Alert';
