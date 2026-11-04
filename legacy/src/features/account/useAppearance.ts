import { useEffect } from 'react';
import { saveTheme, type ThemePreference } from '../../theme';

export function useAppearance(theme: ThemePreference, persist = true) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (persist) saveTheme(theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateThemeColor = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.resolvedTheme = dark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#17251e' : '#fafbf6');
    };
    updateThemeColor();
    if (theme === 'system') media.addEventListener('change', updateThemeColor);
    return () => media.removeEventListener('change', updateThemeColor);
  }, [theme, persist]);
}
