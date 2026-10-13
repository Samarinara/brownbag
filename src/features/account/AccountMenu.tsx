import { DropdownMenuContent, DropdownMenuItem } from '@samarinara/polli-ui/components/menu';
import { Avatar } from '../../ui';
import { useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <DropdownMenuContent
      align="end"
      sideOffset={12}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={() => close()}
      className="account-menu"
      role="menu"
      aria-label="Account menu"
    >
      <div className="account-menu-profile">
        <Avatar
          className="account-menu-avatar"
          name={user.handle?.replace(/^@/, '')[0]?.toUpperCase() || 'A'}
          aria-label={user.handle || 'Your account'}
        />
        <div>
          <strong>{user.handle ? `@${user.handle.replace(/^@/, '')}` : 'Your account'}</strong>
          <span>Your brownbag</span>
        </div>
      </div>
      <div className="theme-picker" role="group" aria-label="Appearance">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            role="menuitemradio"
            aria-checked={theme === value}
            className={theme === value ? 'active' : ''}
            title={`${label} theme`}
            onSelect={(event) => {
              event.preventDefault();
              setTheme(value);
            }}
          >
            <Icon size={15} />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}
      </div>
      <div className="account-menu-actions">
        <DropdownMenuItem onSelect={manage}>
          <Settings size={16} />
          <span>Manage account</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault();
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
        </DropdownMenuItem>
      </div>
      {error && (
        <p className="account-menu-error" role="alert">
          {error}
        </p>
      )}
    </DropdownMenuContent>
  );
}
