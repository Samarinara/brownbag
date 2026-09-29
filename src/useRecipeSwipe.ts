import { useEffect, useRef, type TouchEvent } from 'react';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Horizontal gestures belong to the feed; scrolling, controls, and screen edges do not. */
export function useRecipeSwipe(
  recipeKey: string | undefined,
  enabled: boolean,
  onCommit: (save: boolean) => void,
) {
  const ref = useRef<HTMLElement>(null);
  const gesture = useRef<{ x: number; y: number; axis: 'pending' | 'horizontal' } | null>(null);
  const animation = useRef<Animation | null>(null);
  const incoming = useRef<number | null>(null);
  const offset = useRef(0);

  const reset = () => {
    gesture.current = null;
    incoming.current = null;
    const element = ref.current;
    if (!element) return;
    const from = offset.current;
    offset.current = 0;
    animation.current?.cancel();
    element.style.transform = '';
    if (from && !reducedMotion()) {
      animation.current = element.animate(
        [{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }],
        { duration: 150, easing: 'ease-out' },
      );
    }
  };

  useEffect(() => {
    offset.current = 0;
    gesture.current = null;
    const element = ref.current;
    const direction = incoming.current;
    incoming.current = null;
    if (element && direction !== null && !reducedMotion()) {
      animation.current = element.animate(
        [
          { transform: `translateX(${-direction * 24}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
    return () => {
      animation.current?.cancel();
    };
  }, [recipeKey]);

  useEffect(() => {
    if (!enabled) gesture.current = null;
  }, [enabled]);

  const leave = async (save: boolean) => {
    const element = ref.current;
    const direction = save ? 1 : -1;
    gesture.current = null;
    animation.current?.cancel();
    if (element && !reducedMotion()) {
      const exit = element.animate(
        [
          { transform: `translateX(${offset.current}px)`, opacity: 1 },
          {
            transform: `translateX(${direction * Math.max(96, Math.abs(offset.current) + 40)}px)`,
            opacity: 0,
          },
        ],
        { duration: 150, easing: 'ease-in', fill: 'forwards' },
      );
      animation.current = exit;
      await exit.finished.catch(() => {});
    }
    incoming.current = direction;
  };

  const handlers = {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      if (!enabled) return;
      reset();
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        !touch ||
        touch.clientX < 24 ||
        touch.clientX > window.innerWidth - 24 ||
        window.getSelection()?.toString() ||
        (event.target as Element).closest(
          'button, a, input, textarea, select, summary, .network-tags',
        )
      )
        return;
      gesture.current = { x: touch.clientX, y: touch.clientY, axis: 'pending' };
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (start.axis === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
          reset();
          return;
        }
        start.axis = 'horizontal';
        animation.current?.cancel();
      }
      if (Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      offset.current = Math.sign(dx) * Math.min(Math.abs(dx) * 0.65, window.innerWidth * 0.3);
      if (ref.current && !reducedMotion())
        ref.current.style.transform = `translateX(${offset.current}px)`;
    },
    onTouchCancel: reset,
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const start = gesture.current;
      gesture.current = null;
      if (!enabled) return;
      if (!start) {
        reset();
        return;
      }
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const threshold = Math.max(72, Math.min(110, window.innerWidth * 0.22));
      if (
        start.axis === 'horizontal' &&
        Math.abs(dx) >= threshold &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        onCommit(dx > 0);
      } else reset();
    },
  };
  return { ref, handlers, leave, reset };
}
