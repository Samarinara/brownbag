import { DropdownMenuContent } from '@samarinara/polli-ui/components/menu';
import { Button } from '../../ui';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
    <DropdownMenuContent
      align="end"
      sideOffset={12}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={() => close()}
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
          <Button
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
          </Button>
        ))}
      </div>
      <div className="account-menu-actions">
        <Button role="menuitem" onClick={manage}>
          <Settings size={16} />
          <span>Manage account</span>
        </Button>
        <Button
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
        </Button>
      </div>
      {error && (
        <p className="account-menu-error" role="alert">
          {error}
        </p>
      )}
    </DropdownMenuContent>
  );
}
