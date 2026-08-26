import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPdfRect, textLayout } from '../src/geometry.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const eqRect = (got, want) => { for (const k of ['x','y','w','h']) close(got[k], want[k], k); };

// Unrotated 200x400pt page rendered at scale 2 → 400x800 css px
const vp0 = { scale: 2, rotation: 0, width: 400, height: 800, pdfWidth: 200, pdfHeight: 400 };

test('rotation 0: divides by scale and flips Y', () => {
  // box at css (20, 40) size 100x50 → pdf x=10, top y = 400-20 = 380, bottom = 380-25 = 355
  eqRect(toPdfRect({ x: 20, y: 40, w: 100, h: 50 }, vp0), { x: 10, y: 355, w: 50, h: 25 });
});

test('rotation 0: box at bottom-left of image maps to pdf origin', () => {
  eqRect(toPdfRect({ x: 0, y: 700, w: 40, h: 100 }, vp0), { x: 0, y: 0, w: 20, h: 50 });
});

// Page rotated 90° clockwise: rendered image is 800x400 css px (width = pdfHeight*scale)
const vp90 = { scale: 2, rotation: 90, width: 800, height: 400, pdfWidth: 200, pdfHeight: 400 };

test('rotation 90: top-left of rendered image is bottom-left of unrotated page', () => {
  // A 40x20 css box at rendered (0,0). In unrotated page space it sits at the bottom-left,
  // with w/h swapped: pdf w=10 (from css h 20), h=20 (from css w 40).
  eqRect(toPdfRect({ x: 0, y: 0, w: 40, h: 20 }, vp90), { x: 0, y: 0, w: 10, h: 20 });
});

test('rotation 90: top-right of rendered image is top-left of unrotated page', () => {
  eqRect(toPdfRect({ x: 760, y: 0, w: 40, h: 20 }, vp90), { x: 0, y: 380, w: 10, h: 20 });
});

const vp180 = { scale: 1, rotation: 180, width: 200, height: 400, pdfWidth: 200, pdfHeight: 400 };
test('rotation 180: top-left of rendered image is bottom-right of unrotated page', () => {
  eqRect(toPdfRect({ x: 0, y: 0, w: 40, h: 20 }, vp180), { x: 160, y: 0, w: 40, h: 20 });
});

const vp270 = { scale: 1, rotation: 270, width: 400, height: 200, pdfWidth: 200, pdfHeight: 400 };
test('rotation 270: top-left of rendered image is top-right of unrotated page', () => {
  eqRect(toPdfRect({ x: 0, y: 0, w: 40, h: 20 }, vp270), { x: 180, y: 360, w: 20, h: 40 });
});

test('toPdfRect rejects unknown rotation', () => {
  assert.throws(() => toPdfRect({ x:0, y:0, w:1, h:1 }, { ...vp0, rotation: 45 }), /rotation/);
});

test('textLayout: font size is 80% of box height and baseline sits 0.43·fontSize above the bottom', () => {
  const t = textLayout({ x: 10, y: 100, w: 80, h: 20 });
  close(t.fontSize, 16, 'fontSize');
  close(t.x, 10, 'x');
  close(t.baselineY, 100 + 16 * 0.43, 'baselineY');
});
