import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const stylesPath = new URL('../src/styles.css', import.meta.url);
const networkPath = new URL('../src/network.css', import.meta.url);

function declarations(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]),
  );
}

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('theme colors stay tokenized and avoid component-specific dark patches', async () => {
  const [styles, network] = await Promise.all([
    readFile(stylesPath, 'utf8'),
    readFile(networkPath, 'utf8'),
  ]);
  const withoutTokenBlocks = styles.replace(/:root(?:\[[^\]]+\])?\s*\{[^}]*\}/g, '');

  assert.doesNotMatch(network, /#[\da-f]{3,8}\b/gi);
  assert.doesNotMatch(withoutTokenBlocks, /#[\da-f]{3,8}\b/gi);
  assert.doesNotMatch(styles, /data-resolved-theme=['"]dark['"]\]\s+\./);
  assert.match(network, /\.recipe-gallery figure\s*\{[^}]*var\(--color-surface-media\)/s);
  assert.match(network, /\.recipe-photo\s*\{[^}]*var\(--color-surface-media\)/s);
});

test('core text and action combinations meet AA contrast', async () => {
  const css = await readFile(stylesPath, 'utf8');
  const themes = [
    declarations(css, ':root'),
    declarations(css, ":root[data-resolved-theme='dark']"),
  ];

  for (const theme of themes) {
    assert.ok(contrast(theme['color-text'], theme['color-canvas']) >= 7);
    assert.ok(contrast(theme['color-text-muted'], theme['color-canvas']) >= 4.5);
    assert.ok(contrast(theme['color-text-subtle'], theme['color-canvas']) >= 4.5);
    assert.ok(contrast(theme['color-accent-muted'], theme['color-canvas']) >= 4.5);
    assert.ok(contrast(theme['color-on-accent'], theme['color-action']) >= 4.5);
    assert.ok(contrast(theme['color-text-danger'], theme['color-surface-danger']) >= 4.5);
  }
});
