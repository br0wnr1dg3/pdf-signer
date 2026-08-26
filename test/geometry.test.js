import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPdfRect, textLayout, imageLayout, BASELINE_RATIO, FONT_SIZE_RATIO } from '../src/geometry.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const eqRect = (got, want) => { for (const k of ['x','y','w','h']) close(got[k], want[k], k); };
const eqFields = (got, want) => { for (const k of Object.keys(want)) close(got[k], want[k], k); };

/**
 * Independent check of what pdf-lib will actually paint: rotate the drawn box CCW by
 * `rotate` degrees about its (x, y) anchor and return the axis-aligned rect it sweeps.
 * The width-axis points along `rotate`, the height-axis along `rotate + 90`.
 */
const footprint = ({ x, y, width, height, rotate }) => {
  const th = (rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(th)), sin = Math.round(Math.sin(th)); // exact at multiples of 90
  const pts = [[0, 0], [width, 0], [0, height], [width, height]]
    .map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
};

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

// --- interior rects at scale 2, to catch sign errors the corner cases can hide ---

const vp180s2 = { scale: 2, rotation: 180, width: 400, height: 800, pdfWidth: 200, pdfHeight: 400 };
test('rotation 180: interior rect at scale 2', () => {
  // css (60,100) 80x40 → pts (30,50) 40x20. Image-left edge maps to page-right, image-top to page-bottom:
  // x = pdfWidth - (30 + 40) = 130, y = 50 (already measured from the page bottom), w/h unswapped.
  eqRect(toPdfRect({ x: 60, y: 100, w: 80, h: 40 }, vp180s2), { x: 130, y: 50, w: 40, h: 20 });
});

const vp270s2 = { scale: 2, rotation: 270, width: 800, height: 400, pdfWidth: 200, pdfHeight: 400 };
test('rotation 270: interior rect at scale 2', () => {
  // css (60,100) 80x40 → pts (30,50) 40x20. Image-left edge maps to page-top, image-top to page-right:
  // x = pdfWidth  - (50 + 20) = 130, y = pdfHeight - (30 + 40) = 330, w/h swapped → 20x40.
  eqRect(toPdfRect({ x: 60, y: 100, w: 80, h: 40 }, vp270s2), { x: 130, y: 330, w: 20, h: 40 });
});

// --- whole-page invariant ---

test('a rect covering the whole rendered image is the whole page, at every rotation', () => {
  for (const vp of [vp0, vp90, vp180, vp270, vp180s2, vp270s2]) {
    const got = toPdfRect({ x: 0, y: 0, w: vp.width, h: vp.height }, vp);
    eqRect(got, { x: 0, y: 0, w: vp.pdfWidth, h: vp.pdfHeight });
  }
});

// --- validation and normalization ---

test('toPdfRect rejects unknown rotation', () => {
  assert.throws(() => toPdfRect({ x:0, y:0, w:1, h:1 }, { ...vp0, rotation: 45 }), /rotation/);
});

test('toPdfRect rejects a non-positive or missing scale', () => {
  assert.throws(() => toPdfRect({ x:0, y:0, w:1, h:1 }, { ...vp0, scale: 0 }), /scale/);
  assert.throws(() => toPdfRect({ x:0, y:0, w:1, h:1 }, { ...vp0, scale: undefined }), /scale/);
});

test('rotation is normalized into [0, 360)', () => {
  // -90 is 270, 450 is 90 — same answers as the plain fixtures above.
  eqRect(toPdfRect({ x: 0, y: 0, w: 40, h: 20 }, { ...vp270, rotation: -90 }), { x: 180, y: 360, w: 20, h: 40 });
  eqRect(toPdfRect({ x: 0, y: 0, w: 40, h: 20 }, { ...vp90, rotation: 450 }), { x: 0, y: 0, w: 10, h: 20 });
  eqFields(imageLayout({ x: 10, y: 20, w: 40, h: 30 }, -90), imageLayout({ x: 10, y: 20, w: 40, h: 30 }, 270));
  eqFields(textLayout({ x: 10, y: 20, w: 40, h: 30 }, 450), textLayout({ x: 10, y: 20, w: 40, h: 30 }, 90));
});

test('imageLayout and textLayout reject unknown rotations', () => {
  assert.throws(() => imageLayout({ x:0, y:0, w:1, h:1 }, 45), /rotation/);
  assert.throws(() => textLayout({ x:0, y:0, w:1, h:1 }, 45), /rotation/);
});

// --- ratios ---

test('layout ratios are the calibrated constants', () => {
  close(BASELINE_RATIO, 0.43, 'BASELINE_RATIO');
  close(FONT_SIZE_RATIO, 0.8, 'FONT_SIZE_RATIO');
});

// --- imageLayout ---

const r = { x: 10, y: 20, w: 40, h: 30 };

test('imageLayout: anchor and size per rotation', () => {
  eqFields(imageLayout(r, 0),   { x: 10, y: 20, width: 40, height: 30, rotate: 0 });
  eqFields(imageLayout(r, 90),  { x: 50, y: 20, width: 30, height: 40, rotate: 90 });
  eqFields(imageLayout(r, 180), { x: 50, y: 50, width: 40, height: 30, rotate: 180 });
  eqFields(imageLayout(r, 270), { x: 10, y: 50, width: 30, height: 40, rotate: 270 });
});

test('imageLayout: the rotated image sweeps exactly the target rect', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const got = footprint(imageLayout(r, rotation));
    eqRect(got, r);
  }
});

test('imageLayout defaults to rotation 0', () => {
  eqFields(imageLayout(r), { x: 10, y: 20, width: 40, height: 30, rotate: 0 });
});

// --- textLayout ---

test('textLayout: font size is 80% of the box thickness and the baseline sits 0.43·size inside it', () => {
  // rotation 0: text runs along +x, ascends toward +y → thickness is r.h = 30, size = 24, pad = 10.32
  eqFields(textLayout(r, 0), { x: 10, y: 20 + 24 * 0.43, size: 24, rotate: 0 });
  // rotation 90: text runs along +y, ascends toward -x → thickness is r.w = 40, size = 32, pad = 13.76
  eqFields(textLayout(r, 90), { x: 10 + 40 - 32 * 0.43, y: 20, size: 32, rotate: 90 });
  // rotation 180: runs along -x from the right edge, ascends toward -y → size 24
  eqFields(textLayout(r, 180), { x: 10 + 40, y: 20 + 30 - 24 * 0.43, size: 24, rotate: 180 });
  // rotation 270: runs along -y from the top edge, ascends toward +x → size 32
  eqFields(textLayout(r, 270), { x: 10 + 32 * 0.43, y: 20 + 30, size: 32, rotate: 270 });
});

test('textLayout defaults to rotation 0', () => {
  const t = textLayout({ x: 10, y: 100, w: 80, h: 20 });
  close(t.size, 16, 'size');
  close(t.x, 10, 'x');
  close(t.y, 100 + 16 * 0.43, 'y');
  close(t.rotate, 0, 'rotate');
});

test('textLayout: the baseline start stays inside the target rect at every rotation', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const t = textLayout(r, rotation);
    assert.ok(t.x >= r.x && t.x <= r.x + r.w, `x in rect at ${rotation}: ${t.x}`);
    assert.ok(t.y >= r.y && t.y <= r.y + r.h, `y in rect at ${rotation}: ${t.y}`);
  }
});
