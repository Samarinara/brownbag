import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import type { SessionUser } from '../../../shared/atproto';
import type { ThemePreference } from '../../theme';
import { message } from '../../errors';

const themeOptions: { value: ThemePreference; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AccountMenu({
  user,
  theme,
  setTheme,
  close,
  manage,
  signOut,
}: {
  user: SessionUser;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  close: (restoreFocus?: boolean) => void;
  manage: () => void;
  signOut: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !ref.current?.contains(target) &&
        !target.closest('.network-account-button')
      )
        close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [close]);
  const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div
      className="account-menu"
      role="menu"
      ref={ref}
      onKeyDown={moveMenuFocus}
      aria-label="Account menu"
    >
      <div className="account-menu-profile">
        <span className="account-menu-avatar">
          {(user.handle?.replace(/^@/, '')[0] || 'A').toUpperCase()}
        </span>
        <div>
          <strong>{user.handle ? `@${user.handle.replace(/^@/, '')}` : 'Your account'}</strong>
          <span>Your brownbag</span>
        </div>
      </div>
      <div className="theme-picker" role="radiogroup" aria-label="Appearance">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className={theme === value ? 'active' : ''}
            onClick={() => setTheme(value)}
            title={`${label} theme`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="account-menu-actions">
        <button role="menuitem" onClick={manage}>
          <Settings size={16} />
          <span>Manage account</span>
        </button>
        <button
          role="menuitem"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void signOut().catch((e) => {
              setError(message(e));
              setBusy(false);
            });
          }}
        >
          <LogOut size={16} />
          <span>{busy ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
      {error && (
        <p className="account-menu-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
