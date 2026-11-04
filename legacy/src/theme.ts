export type ThemePreference = 'system' | 'light' | 'dark';

export function savedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem('brownbag-theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(theme: ThemePreference) {
  try {
    localStorage.setItem('brownbag-theme', theme);
  } catch {
    // Theme changes still apply for this session when browser storage is unavailable.
  }
}
