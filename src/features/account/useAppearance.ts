import { useEffect } from 'react';
import { saveTheme, type ThemePreference } from '../../theme';

export function useAppearance(theme: ThemePreference) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateThemeColor = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.resolvedTheme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#20241f' : '#f7f5ee');
    };
    updateThemeColor();
    if (theme === 'system') media.addEventListener('change', updateThemeColor);
    return () => media.removeEventListener('change', updateThemeColor);
  }, [theme]);
}
