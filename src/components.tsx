import { Button } from './ui';
import { useRef, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@samarinara/polli-ui/components/dialog';
import { Alert, Skeleton } from '@samarinara/polli-ui/components/layout';
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
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={wide ? 'modal wide' : 'modal'}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      >
        <div className="modal-head">
          <DialogTitle>{title}</DialogTitle>
        </div>
        <div className="modal-body">{children}</div>
      </DialogContent>
    </Dialog>
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
        <Button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.onAction?.();
          }}
        >
          {toast.actionLabel}
        </Button>
      )}
      <Button
        type="button"
        className="toast-close"
        onClick={dismiss}
        aria-label="Dismiss notification"
        title="Dismiss notification"
      >
        <X size={15} />
      </Button>
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
          <Button type="button" className="button secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            autoFocus
            className={danger ? 'button danger' : 'button primary'}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
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
            <Skeleton className="skeleton skeleton-line short" />
            <Skeleton className="skeleton skeleton-line title" />
            <Skeleton className="skeleton skeleton-line" />
            <Skeleton className="skeleton skeleton-line narrow" />
          </div>
        </div>
      ))}
    </div>
  );
}
export function SkeletonDetail() {
  return (
    <div className="skeleton-detail" aria-hidden="true">
      <Skeleton className="skeleton skeleton-line short" />
      <Skeleton className="skeleton skeleton-line hero" />
      <Skeleton className="skeleton skeleton-line" />
      <Skeleton className="skeleton skeleton-line narrow" />
    </div>
  );
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <Alert title="Please try again" className="error" role="alert">
      {error}
    </Alert>
  ) : null;
}
