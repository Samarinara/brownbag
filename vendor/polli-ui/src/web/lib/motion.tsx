'use client';
import * as React from 'react';

const MotionContext = React.createContext(false);
export const MotionProvider = MotionContext.Provider;

// A changed action key replays a gesture. Mounting, hovering, and rerendering
// with the same key leave it still, including when the initial state is active.
export function useActionRevision(value: unknown) {
  const [snapshot, setSnapshot] = React.useState({ value, revision: 0 });
  if (!Object.is(snapshot.value, value)) {
    setSnapshot({ value, revision: snapshot.revision + 1 });
  }
  return snapshot.revision;
}

// Default content stays still, including SSR and hydration. Track state
// changes during render so controlled and uncontrolled reveals start together.
function useMotionGate(value: string) {
  const [snapshot, setSnapshot] = React.useState({ value, enabled: false });
  if (snapshot.value !== value) {
    setSnapshot({ value, enabled: true });
  }
  return snapshot.enabled;
}

// Control Radix's value here so its state and motion commit together. Radix's
// uncontrolled change notification runs in an effect, too late to start a
// reveal before the content is first painted.
export function useMotionState<T extends boolean | string | string[]>(value: T | undefined, defaultValue: T) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value === undefined ? internal : value;
  const motion = useMotionGate(JSON.stringify(current));
  const change = (next: T) => {
    if (value === undefined) setInternal(next);
  };
  return [current, change, motion] as const;
}

export function useMotionAttribute() {
  return React.useContext(MotionContext) ? 'interaction' : undefined;
}
