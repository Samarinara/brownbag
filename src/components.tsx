import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';

export function Bag({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 27 : 52}
      height={small ? 32 : 60}
      viewBox="0 0 52 60"
      fill="none"
      aria-hidden="true"
    >
      <path d="M10 18h32l4 36H6l4-36Z" fill="currentColor" />
      <path d="M17 20V12a9 9 0 0 1 18 0v8" stroke="currentColor" strokeWidth="4" />
      <path
        d="m19 34 5 5 10-11"
        stroke="var(--paper)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      // Native dialogs generally restore focus, but retaining this explicitly also
      // covers dialog removal after an async action or route change.
      requestAnimationFrame(() => opener.current?.focus());
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      className={wide ? 'modal wide' : 'modal'}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const bounds = ref.current.getBoundingClientRect();
          if (
            e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
          title="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export type ToastData = {
  kind: 'success' | 'error';
  text: string;
  actionLabel?: string;
  onAction?: () => void;
};
export function Toast({ toast, dismiss }: { toast: ToastData; dismiss: () => void }) {
  return (
    <div
      className={`network-toast ${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      {toast.kind === 'error' ? <AlertTriangle size={17} /> : <Check size={17} />}
      <span className="toast-text">{toast.text}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.onAction?.();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        onClick={dismiss}
        aria-label="Dismiss notification"
        title="Dismiss notification"
      >
        <X size={15} />
      </button>
    </div>
  );
}
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  close,
  confirm,
  busy = false,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  close: () => void;
  confirm: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal title={title} close={close}>
      <div className="stack">
        <div className="confirm-body">{children}</div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className={danger ? 'button danger' : 'button primary'}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="network-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="network-card skeleton-card" key={i}>
          <div className="network-card-body">
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line narrow" />
          </div>
        </div>
      ))}
    </div>
  );
}
export function SkeletonDetail() {
  return (
    <div className="skeleton-detail" aria-hidden="true">
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-line hero" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line narrow" />
    </div>
  );
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
