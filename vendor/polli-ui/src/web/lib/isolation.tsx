'use client';

import * as React from 'react';

const ModalIsolationContext = React.createContext(false);
export const ModalIsolationProvider = ModalIsolationContext.Provider;
const isolated = new WeakMap<HTMLElement, { count: number; original: boolean }>();

// Radix owns focus trapping and aria-hidden. Inert also removes background
// controls from keyboard/programmatic focus. Counts preserve nested modals.
export function useModalIsolation<T extends HTMLElement>(forwardedRef: React.ForwardedRef<T>) {
  const active = React.useContext(ModalIsolationContext);
  const [element, setElement] = React.useState<T | null>(null);
  const ref = React.useCallback((node: T | null) => {
    setElement(node);
    if (typeof forwardedRef === 'function') {
      const cleanup: unknown = forwardedRef(node);
      if (typeof cleanup === 'function') return () => { setElement(null); cleanup(); };
    } else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  React.useEffect(() => {
    if (!active || !element) return;
    const siblings: HTMLElement[] = [];
    let branch: HTMLElement = element;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.hasAttribute('data-radix-focus-guard') || sibling.matches('script,style,link,[data-polli="dialog-overlay"]')) continue;
        const state = isolated.get(sibling) ?? { count: 0, original: sibling.hasAttribute('inert') };
        state.count += 1;
        isolated.set(sibling, state);
        sibling.setAttribute('inert', '');
        siblings.push(sibling);
      }
      if (parent === element.ownerDocument.body) break;
      branch = parent;
    }
    return () => {
      for (const sibling of siblings) {
        const state = isolated.get(sibling)!;
        state.count -= 1;
        if (state.count === 0) {
          if (!state.original) sibling.removeAttribute('inert');
          isolated.delete(sibling);
        }
      }
    };
  }, [active, element]);

  return ref;
}
