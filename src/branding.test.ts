import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses the Ronin mark for the sidebar and the app icon for extension details', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.icon).toBe('dist/ronin-icon.png');
  expect(manifest.contributes.viewsContainers.activitybar[0].icon).toBe('dist/ronin.svg');
  const svg = readFileSync(new URL('./ronin.svg', import.meta.url), 'utf8');
  expect(svg).toContain('fill="currentColor"');
  expect(svg).toContain('M520 778Q598 759');
  expect(svg).not.toMatch(/<rect|<image|<script|<text/);
  const png = readFileSync(new URL('./ronin-icon.png', import.meta.url));
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(512);
  expect(png.readUInt32BE(20)).toBe(512);
});
