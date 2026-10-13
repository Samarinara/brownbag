import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { savedTheme, saveTheme } from '../src/theme';

test('theme preferences fall back to the system and tolerate blocked storage', (t) => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  assert.equal(savedTheme(), 'system');
  saveTheme('dark');
  assert.equal(savedTheme(), 'dark');
  saveTheme('light');
  assert.equal(savedTheme(), 'light');
  values.set('brownbag-theme', 'invalid');
  assert.equal(savedTheme(), 'system');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage blocked');
    },
  });
  assert.equal(savedTheme(), 'system');
  assert.doesNotThrow(() => saveTheme('dark'));
});

const stylesPath = new URL('../src/styles.css', import.meta.url);
const networkPath = new URL('../src/network.css', import.meta.url);

test('theme colors stay tokenized and avoid component-specific dark patches', async () => {
  const [styles, network, pwa, polli] = await Promise.all([
    readFile(stylesPath, 'utf8'),
    readFile(networkPath, 'utf8'),
    readFile(new URL('../src/pwa.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/polli.css', import.meta.url), 'utf8'),
  ]);
  const withoutTokenBlocks = `${styles}\n${polli}`.replace(
    /:root(?:\.dark|\[[^\]]+\])?\s*\{[^}]*\}/g,
    '',
  );

  assert.doesNotMatch(pwa, /#[\da-f]{3,8}\b/gi);
  assert.doesNotMatch(network, /#[\da-f]{3,8}\b/gi);
  assert.doesNotMatch(withoutTokenBlocks, /#[\da-f]{3,8}\b/gi);
  assert.doesNotMatch(styles, /data-resolved-theme=['"]dark['"]\]\s+\./);
  assert.match(network, /\.recipe-gallery figure\s*\{[^}]*var\(--color-surface-media\)/s);
  assert.match(network, /\.recipe-photo\s*\{[^}]*var\(--color-surface-media\)/s);
});
