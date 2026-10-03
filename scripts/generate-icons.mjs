import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
const logo = await readFile(new URL('../public/favicon.svg', import.meta.url));
const icons = new URL('../public/icons/', import.meta.url);
await mkdir(icons, { recursive: true });
for (const [name, size] of [
  ['icon-192', 192],
  ['icon-512', 512],
  ['apple-touch-icon', 180],
]) {
  await sharp(logo)
    .resize(size, size)
    .png()
    .toFile(new URL(`${name}.png`, icons).pathname);
}
// Keep the entire existing mark inside the maskable icon's safe area.
const inset = await sharp(logo).resize(320, 320).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#466542' } })
  .composite([{ input: inset, gravity: 'centre' }])
  .png()
  .toFile(new URL('maskable-512.png', icons).pathname);
