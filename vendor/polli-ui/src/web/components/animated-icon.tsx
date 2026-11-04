'use client';
import * as React from 'react';
import { useActionRevision } from '../lib/motion';

// Copy, bookmark, and bell adapted from lucide-animated (pqoqubbw/icons).
// MIT attribution is included in THIRD_PARTY_NOTICES.md. Polli keeps the SVG
// geometry and tunes the gestures with CSS, without a Motion runtime.
export type AnimatedIconName = 'copy' | 'pencil' | 'bookmark' | 'bell' | 'check';
export type ActionKey = string | number | boolean;
export type AnimatedIconProps = React.ComponentPropsWithoutRef<'svg'> & {
  name: AnimatedIconName;
  /** Change after an action or successful result to play once. */
  animationKey?: ActionKey;
  /** Persistent bookmark state. Its initial value never starts a gesture. */
  active?: boolean;
  size?: number;
};

export const AnimatedIcon = React.forwardRef<SVGSVGElement, AnimatedIconProps>(
  ({ name, animationKey, active = false, size = 20, ...props }, ref) => {
    const revision = useActionRevision(animationKey);
    return (
      <svg ref={ref} data-polli="animated-icon" data-icon={name} data-active={active || undefined}
        width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <g key={revision} data-polli="icon-gesture" data-polli-motion={revision ? 'interaction' : undefined}>
          {name === 'copy' ? <>
            <rect data-icon-part="sheet" x="8" y="8" width="14" height="14" rx="2" />
            <path data-icon-part="back-sheet" d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </> : name === 'bookmark' ? <>
            <path data-icon-part="ribbon-fill" stroke="none" fill="currentColor" d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            <path d="M5 18V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13" />
            <path data-icon-part="ribbon-tip" d="M5 18v3l7-4 7 4v-3" />
          </> : name === 'bell' ? <g data-icon-part="bell">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </g> : name === 'pencil' ? <>
            <path data-icon-part="pencil-line" pathLength="1" d="M4 21h8" />
            <g data-icon-part="pencil">
              <path d="m16 3 5 5-12 12-6 1 1-6Z" />
              <path d="m14 5 5 5M4 15l5 5" />
            </g>
          </> : <path data-icon-part="check" pathLength="1" d="m5 12 4 4L19 6" />}
        </g>
      </svg>
    );
  },
);
AnimatedIcon.displayName = 'AnimatedIcon';
