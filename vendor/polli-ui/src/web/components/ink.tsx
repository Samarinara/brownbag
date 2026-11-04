'use client';
import * as React from 'react';
import { cn } from '../lib/utils';
import { useActionRevision } from '../lib/motion';
import type { ActionKey } from './animated-icon';

export type InkTextProps = React.ComponentPropsWithoutRef<'span'> & {
  crossedOut?: boolean;
  /** Change after a successful save; wrap the Save button label to underline it. */
  underlineKey?: ActionKey;
};

export const InkText = React.forwardRef<HTMLSpanElement, InkTextProps>(
  ({ crossedOut = false, underlineKey, className, children, ...props }, ref) => {
    const revision = useActionRevision(underlineKey);
    return <span ref={ref} data-polli="ink-text" data-crossed-out={crossedOut || undefined}
      className={cn('polli-handwritten', className)} {...props}>
      <span data-polli="ink-words">{children}</span>
      <span key={revision} data-polli="ink-underline" data-polli-motion={revision ? 'interaction' : undefined} aria-hidden="true" />
    </span>;
  },
);
InkText.displayName = 'InkText';

export type InkRemovalProps = React.ComponentPropsWithoutRef<'div'> & {
  removed: boolean;
  /** Commit deletion after the mark and gap closure finish. */
  onExitComplete: () => void;
};

export function InkRemoval({ removed, onExitComplete, children, className, onAnimationEnd, ...props }: InkRemovalProps) {
  const revision = useActionRevision(removed);
  const root = React.useRef<HTMLDivElement>(null);
  const completed = React.useRef(false);
  const complete = React.useCallback(() => {
    if (!completed.current) {
      completed.current = true;
      onExitComplete();
    }
  }, [onExitComplete]);

  React.useEffect(() => {
    if (!removed) { completed.current = false; return; }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finishIfStill = () => { if (!revision || media.matches) complete(); };
    finishIfStill();
    // Styles can be missing or an app can suppress animations. Deletion must
    // still finish if animationend never arrives. Follow the actual CSS timing.
    const style = root.current ? window.getComputedStyle(root.current) : undefined;
    const milliseconds = (value: string) => value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
    const durations = (style?.animationDuration ?? '').split(',').map(milliseconds);
    const delays = (style?.animationDelay ?? '').split(',').map(milliseconds);
    const deadline = Math.max(0, ...durations.map((duration, index) => (duration || 0) + (delays[index % delays.length] || 0)));
    let timeout: number;
    const finishWhenSettled = () => {
      if (completed.current) return;
      const active = root.current?.getAnimations?.().some(animation =>
        'animationName' in animation && animation.animationName === 'polli-close-gap' && (animation.playState === 'running' || animation.playState === 'paused'));
      // Respect deliberately paused motion and a throttled animation timeline.
      // If the animation disappears or finishes without an event, still commit.
      if (active) timeout = window.setTimeout(finishWhenSettled, 50);
      else complete();
    };
    timeout = window.setTimeout(finishWhenSettled, deadline + 50);
    media.addEventListener('change', finishIfStill);
    return () => { window.clearTimeout(timeout); media.removeEventListener('change', finishIfStill); };
  }, [removed, revision, complete]);

  // React 18 treats inert as an unknown string attribute; React 19 knows its
  // boolean semantics. Emit valid HTML in both supported React versions.
  const inertProps = { inert: removed ? (parseInt(React.version, 10) < 19 ? '' : true) : undefined } as React.HTMLAttributes<HTMLDivElement>;
  return <div ref={root} data-polli="ink-removal" data-removed={removed || undefined}
    data-polli-motion={revision ? 'interaction' : undefined} className={className}
    {...inertProps} {...props} onAnimationEnd={event => {
      onAnimationEnd?.(event);
      if (removed && event.target === event.currentTarget && event.animationName === 'polli-close-gap') complete();
    }}>
    <div data-polli="ink-removal-content">{children}</div>
  </div>;
}
