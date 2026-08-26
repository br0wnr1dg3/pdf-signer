# PDF Signer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-install, offline, single-page web app on macOS that places a hand-drawn signature, date, and text onto a PDF and downloads a signed copy.

**Architecture:** Static `index.html` + ES modules in `src/`. pdf.js renders pages to canvases; DOM overlays are positioned on top of each page; on export, pdf-lib embeds the signature PNG and text into the original bytes using a pure coordinate-conversion module. No backend, no build step; a `python3 -m http.server` launcher because pdf.js needs ES modules + a worker (blocked on `file://`).

**Tech Stack:** Vanilla JS (ES modules), pdfjs-dist 6.x (vendored), pdf-lib 1.17 (vendored), `node --test` for unit tests, Python 3 stdlib http.server for launching.

**Spec:** `docs/superpowers/specs/2026-08-26-pdf-signer-design.md`

---

## File structure

```
pdf-signer/
├── index.html               # markup: toolbar, drop zone, page container, signature modal, toast
├── styles.css               # all styling
├── open.command             # double-click launcher: starts http.server on :8765, opens browser
├── package.json             # {"type":"module"}, "test": "node --test"
├── README.md                # usage + manual test checklist
├── vendor/
│   ├── pdf.min.mjs          # pdfjs-dist/build/pdf.min.mjs
│   ├── pdf.worker.min.mjs   # pdfjs-dist/build/pdf.worker.min.mjs
│   └── pdf-lib.min.js       # pdf-lib/dist/pdf-lib.min.js (UMD → window.PDFLib)
├── src/
│   ├── geometry.js          # pure: CSS-pixel rect → PDF-point rect (scale, Y-flip, rotation)
│   ├── pdfView.js           # load File → render pages into #pages, return viewports
│   ├── signaturePad.js      # draw/upload modal, localStorage persistence
│   ├── overlays.js          # overlay model + drag/resize/edit/delete DOM behaviour
│   ├── exporter.js          # pdf-lib: burn overlays into PDF, trigger download
│   ├── toast.js             # showToast(message)
│   └── app.js               # wires everything
├── test/
│   └── geometry.test.js
└── samples/
    ├── make-samples.mjs     # generates the 3 sample PDFs with pdf-lib (node)
    ├── portrait.pdf
    ├── landscape.pdf
    └── rotated90.pdf
```

**Overlay model** (used by `overlays.js` and `exporter.js`):

```js
// { id: string, page: number (0-based), type: 'signature'|'date'|'text',
//   x: number, y: number, w: number, h: number,   // CSS px, relative to the page wrapper's top-left
//   value: string }                                 // dataURL for signature, text otherwise
```

**Viewport info** (returned by `pdfView.js`, consumed by `geometry.js`):

```js
// { scale: number, rotation: 0|90|180|270, width: number, height: number, // rendered CSS px
//   pdfWidth: number, pdfHeight: number,   // unrotated page size in PDF points (UserUnit assumed 1)
//   offsetX: number, offsetY: number }     // CropBox origin in points, usually 0 — added back by toPdfRect
```

---

### Task 1: Scaffold project, vendor libraries, launcher

**Files:**
- Create: `package.json`, `.gitignore`, `open.command`, `index.html`, `styles.css`, `src/toast.js`, `README.md`
- Create: `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs`, `vendor/pdf-lib.min.js`

- [ ] **Step 1: package.json and .gitignore**

```json
{
  "name": "pdf-signer",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "start": "python3 -m http.server 8765 --bind 127.0.0.1",
    "samples": "node samples/make-samples.mjs"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
*-signed.pdf
```

- [ ] **Step 2: Vendor the libraries (one-off fetch via npm pack, then delete tarballs)**

Run from the project root:
```bash
mkdir -p vendor /tmp/pdfsigner-vendor && cd /tmp/pdfsigner-vendor
npm pack pdfjs-dist@6 pdf-lib@1.17.1 --silent
tar xzf pdfjs-dist-*.tgz && tar xzf pdf-lib-*.tgz
cp package/build/pdf.min.mjs        "$OLDPWD/vendor/pdf.min.mjs"
cp package/build/pdf.worker.min.mjs "$OLDPWD/vendor/pdf.worker.min.mjs"
```
Note: both tarballs extract to `package/`; extract them one at a time:
```bash
cd /tmp/pdfsigner-vendor && rm -rf package && tar xzf pdf-lib-*.tgz && cp package/dist/pdf-lib.min.js "$OLDPWD/vendor/pdf-lib.min.js"; cd -
rm -rf /tmp/pdfsigner-vendor
ls -la vendor
```
Expected: three files, `pdf.min.mjs` and `pdf.worker.min.mjs` each several hundred KB, `pdf-lib.min.js` ~500 KB. Add `vendor/README.md` with one line: `pdfjs-dist 6.2.108 (Apache-2.0): pdf.min.mjs, pdf.worker.min.mjs. pdf-lib 1.17.1 (MIT): pdf-lib.min.js. Vendored unmodified from npm.`

- [ ] **Step 3: open.command launcher**

```bash
#!/bin/bash
# Double-click me. Starts a local server (localhost only) and opens the app.
cd "$(dirname "$0")" || exit 1
PORT=8765
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install Xcode Command Line Tools: xcode-select --install"; read -r; exit 1
fi
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  disown
  for _ in $(seq 1 20); do lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 0.1; done
fi
open "http://localhost:$PORT/"
```
Run: `chmod +x open.command`

- [ ] **Step 4: index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PDF Signer</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="toolbar">
    <button id="btn-open" class="btn primary">Open PDF</button>
    <input id="file-input" type="file" accept="application/pdf" hidden />
    <span class="sep"></span>
    <button id="btn-sign" class="btn">Sign</button>
    <button id="btn-add-signature" class="btn" disabled>+ Signature</button>
    <button id="btn-add-date" class="btn" disabled>+ Date</button>
    <button id="btn-add-text" class="btn" disabled>+ Text</button>
    <button id="btn-date-format" class="btn ghost" title="Toggle date format">DD/MM/YYYY</button>
    <span class="spacer"></span>
    <span id="file-name" class="file-name"></span>
    <button id="btn-save" class="btn primary" disabled>Save signed PDF</button>
  </header>

  <main id="main">
    <div id="drop-zone" class="drop-zone">
      <p>Drop a PDF here</p>
      <p class="muted">or use “Open PDF”</p>
    </div>
    <div id="pages" class="pages" hidden></div>
  </main>

  <div id="sig-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="sig-title" hidden>
    <div class="modal-card">
      <h2 id="sig-title">Draw your signature</h2>
      <canvas id="sig-canvas" width="600" height="220"></canvas>
      <div class="modal-row">
        <label>Pen <input id="sig-width" type="range" min="1" max="6" value="2.5" step="0.5" /></label>
        <button id="sig-clear" class="btn ghost">Clear</button>
        <button id="sig-upload-btn" class="btn ghost">Upload image</button>
        <input id="sig-upload" type="file" accept="image/png,image/jpeg" hidden />
        <span class="spacer"></span>
        <button id="sig-cancel" class="btn">Cancel</button>
        <button id="sig-save" class="btn primary">Save signature</button>
      </div>
    </div>
  </div>

  <div id="toast" class="toast" role="status" hidden></div>

  <script src="vendor/pdf-lib.min.js"></script>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 5: styles.css**

```css
:root { --bg:#e9ebee; --bar:#fff; --accent:#2f6fed; --text:#1c1e21; --muted:#6b7280; --border:#d1d5db; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin:0; min-height:100%; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color:var(--text); background:var(--bg); }
.toolbar { position:sticky; top:0; z-index:20; display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 14px; background:var(--bar); border-bottom:1px solid var(--border); }
.toolbar .sep { width:1px; height:22px; background:var(--border); margin:0 4px; }
.toolbar .spacer, .modal-row .spacer { flex:1; }
.file-name { color:var(--muted); margin-right:8px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.btn { display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border:1px solid var(--border); border-radius:8px; background:#fff; cursor:pointer; font:inherit; flex-shrink:0; }
.btn:hover:not(:disabled) { background:#f3f4f6; }
.btn:disabled { opacity:.45; cursor:default; }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.btn.primary:hover:not(:disabled) { background:#245cd0; }
.btn.ghost { background:transparent; }
#main { padding:24px 16px 80px; display:flex; flex-direction:column; align-items:center; }
.drop-zone { width:min(800px, 100%); height:60vh; display:flex; flex-direction:column; justify-content:center; align-items:center; border:2px dashed var(--border); border-radius:16px; color:var(--text); font-size:20px; background:#fff; }
.drop-zone.over { border-color:var(--accent); background:#eef3ff; }
.muted { color:var(--muted); font-size:14px; }
.pages { display:flex; flex-direction:column; align-items:center; gap:20px; }
.page { position:relative; background:#fff; box-shadow:0 2px 10px rgba(0,0,0,.15); flex-shrink:0; }
.page canvas { display:block; }
.overlay { position:absolute; cursor:move; user-select:none; touch-action:none; }
.overlay img { width:100%; height:100%; display:block; pointer-events:none; }
.overlay.text, .overlay.date { font-family:Helvetica, Arial, sans-serif; white-space:nowrap; overflow:hidden; outline:none; line-height:1; }
.overlay[contenteditable="true"] { user-select:text; cursor:text; }
.overlay.selected { outline:1px solid var(--accent); outline-offset:0; }
.overlay .handle { position:absolute; right:-6px; bottom:-6px; width:12px; height:12px; background:var(--accent); border-radius:50%; cursor:nwse-resize; display:none; }
.overlay.selected .handle { display:block; }
.modal { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:50; }
.modal-card { background:#fff; padding:20px; border-radius:14px; width:640px; max-width:95vw; }
.modal-card h2 { margin:0 0 12px; font-size:18px; }
#sig-canvas { width:100%; border:1px solid var(--border); border-radius:8px; background:#fff; touch-action:none; cursor:crosshair; }
.modal-row { display:flex; align-items:center; gap:10px; margin-top:12px; }
.toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#111827; color:#fff; padding:10px 16px; border-radius:10px; z-index:60; box-shadow:0 4px 14px rgba(0,0,0,.3); }
```

- [ ] **Step 6: src/toast.js**

```js
let timer;
export function showToast(message, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, ms);
}
```

- [ ] **Step 7: Placeholder src/app.js so the page loads without console errors**

```js
import { showToast } from './toast.js';

document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-input').click());

console.log('PDF Signer loaded');
```

- [ ] **Step 8: README.md (usage section only; checklist added in Task 7)**

```markdown
# PDF Signer

Sign PDFs locally on your Mac. No accounts, no uploads, no Adobe.

## Run
Double-click `open.command` (or `npm start` then visit http://localhost:8765).

## Use
1. Open / drop a PDF.
2. **Sign** — draw once (or upload a PNG). It's saved in your browser for next time.
3. **+ Signature / + Date / + Text** — drag to move, drag the blue corner to resize, double-click text to edit, `Delete` to remove.
4. **Save signed PDF** — downloads `<name>-signed.pdf`. The original is untouched.

## Tests
`npm test`
```

- [ ] **Step 9: Verify it loads**

Run: `python3 -m http.server 8765 &` then `curl -s http://localhost:8765/ | head -5`; expected `<!doctype html>`. Open http://localhost:8765 in a browser: toolbar + drop zone visible, console shows "PDF Signer loaded". Kill the server afterwards (`kill %1`).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: scaffold PDF signer page, vendor pdf.js and pdf-lib, add launcher"
```

---

### Task 2: geometry.js (pure coordinate conversion, TDD)

**Files:**
- Create: `src/geometry.js`
- Test: `test/geometry.test.js`

pdf.js renders a page with a `scale` and a `rotation` (the page's `/Rotate` value). Overlay rects are CSS px in the *rendered* (rotated) image with origin top-left, Y down. pdf-lib draws in *unrotated* page space with origin bottom-left, Y up. For text we also need a font size: the box height in points × 0.8 (so Helvetica's ascender fits inside the box), and pdf-lib's `drawText` y is the baseline, so baseline = bottom + fontSize × 0.43 (calibrated against the browser preview: with `line-height:1` and the box 1.25× the font size, the CSS baseline sits ≈0.34·h above the box bottom = 0.43·fontSize).

- [ ] **Step 1: Write the failing tests**

```js
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

// --- CropBox origin ---

test('a non-zero CropBox origin shifts the result and defaults to 0', () => {
  const rect = { x: 20, y: 40, w: 100, h: 50 };
  const plain = toPdfRect(rect, vp0);
  const shifted = toPdfRect(rect, { ...vp0, offsetX: 5, offsetY: 7 });
  eqRect(shifted, { x: plain.x + 5, y: plain.y + 7, w: plain.w, h: plain.h });
});

// --- whole-page invariant ---

test('a rect covering the whole rendered image is the whole page, at every rotation', () => {
  for (const vp of [vp0, vp90, vp180, vp270, vp180s2, vp270s2]) {
    const got = toPdfRect({ x: 0, y: 0, w: vp.width, h: vp.height }, vp);
    eqRect(got, { x: 0, y: 0, w: vp.pdfWidth, h: vp.pdfHeight });
  }
});

test('with a CropBox origin, the whole rendered image is the whole page at that origin, at every rotation', () => {
  for (const vp of [vp0, vp90, vp180, vp270, vp180s2, vp270s2]) {
    const got = toPdfRect({ x: 0, y: 0, w: vp.width, h: vp.height }, { ...vp, offsetX: 5, offsetY: 7 });
    eqRect(got, { x: 5, y: 7, w: vp.pdfWidth, h: vp.pdfHeight });
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/geometry.js'`

- [ ] **Step 3: Implement**

```js
/** Fraction of the font size between the box bottom and the text baseline (matches the CSS preview). */
export const BASELINE_RATIO = 0.43;

/** Font size as a fraction of the text box's thickness, so Helvetica's ascender fits inside. */
export const FONT_SIZE_RATIO = 0.8;

/** Accept any multiple of 90 (including negatives) and reduce it to 0 | 90 | 180 | 270. */
function normalizeRotation(rotation) {
  const r = ((rotation % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(r)) throw new Error(`Unsupported page rotation: ${r}`);
  return r;
}

/**
 * Convert a rect in rendered CSS pixels (origin top-left, Y down, on the ROTATED page image)
 * into unrotated PDF points (origin bottom-left, Y up) for pdf-lib.
 *
 * viewport: { scale, rotation (0|90|180|270), pdfWidth, pdfHeight, offsetX?, offsetY? } — the
 * rendered width/height are implied by scale and rotation, so they are not read here.
 * offsetX/offsetY are the CropBox origin in points (default 0), added back at the end so the
 * result is in PDF user space rather than relative to the visible box.
 */
export function toPdfRect(rect, viewport) {
  const { scale, pdfWidth, pdfHeight } = viewport;
  const offsetX = viewport.offsetX ?? 0, offsetY = viewport.offsetY ?? 0;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid scale: ${scale}`);
  const rotation = normalizeRotation(viewport.rotation);

  // 1. CSS px → points, still in rotated-image space with origin top-left.
  const x = rect.x / scale, y = rect.y / scale, w = rect.w / scale, h = rect.h / scale;
  // Rotated image size in points:
  const rw = (rotation === 90 || rotation === 270) ? pdfHeight : pdfWidth;
  const rh = (rotation === 90 || rotation === 270) ? pdfWidth : pdfHeight;

  // 2. Map the rect's corners from rotated top-left space to unrotated bottom-left space.
  // Work with the rect's four corners so w/h swap falls out naturally.
  const mapPoint = {
    0:   ([px, py]) => [px, rh - py],
    90:  ([px, py]) => [py, px],           // image-left edge = page-bottom, image-top edge = page-left
    180: ([px, py]) => [rw - px, py],      // image-left edge = page-right,  image-top edge = page-bottom
    270: ([px, py]) => [rh - py, rw - px], // image-left edge = page-top,    image-top edge = page-right
  }[rotation];

  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(mapPoint);
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  // 3. Shift out of CropBox-relative space into PDF user space.
  return { x: minX + offsetX, y: minY + offsetY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/**
 * Args for pdf-lib's `page.drawImage` that paint the image into `pdfRect` (unrotated page
 * points) turned `rotation`° so it reads upright once the viewer applies the page's /Rotate.
 *
 * pdf-lib rotates counter-clockwise about the (x, y) anchor, mapping the image's width-axis
 * to `rotation` and its height-axis to `rotation + 90`; the anchor corner below is the one
 * that makes the swept rect exactly `pdfRect`. `rotate` is degrees — wrap it in `degrees()`.
 */
export function imageLayout(pdfRect, rotation = 0) {
  const rot = normalizeRotation(rotation);
  const r = pdfRect;
  return {
    ...{
      0:   { x: r.x,       y: r.y,       width: r.w, height: r.h },
      90:  { x: r.x + r.w, y: r.y,       width: r.h, height: r.w },
      180: { x: r.x + r.w, y: r.y + r.h, width: r.w, height: r.h },
      270: { x: r.x,       y: r.y + r.h, width: r.h, height: r.w },
    }[rot],
    rotate: rot,
  };
}

/**
 * Args for pdf-lib's `page.drawText` that fit a single line into `pdfRect` (unrotated page
 * points) turned `rotation`° so it reads upright once the viewer applies the page's /Rotate.
 *
 * The anchor is the baseline start. Text runs along `rotation` and ascends toward
 * `rotation + 90`, so the box thickness that sets the font size is the rect's height at
 * 0/180 and its width at 90/270, and the baseline sits `size * BASELINE_RATIO` in from
 * whichever edge is "below" the text. `rotate` is degrees — wrap it in `degrees()`.
 */
export function textLayout(pdfRect, rotation = 0) {
  const rot = normalizeRotation(rotation);
  const r = pdfRect;
  const size = ((rot === 90 || rot === 270) ? r.w : r.h) * FONT_SIZE_RATIO;
  const pad = size * BASELINE_RATIO;
  return {
    ...{
      0:   { x: r.x,             y: r.y + pad },
      90:  { x: r.x + r.w - pad, y: r.y },
      180: { x: r.x + r.w,       y: r.y + r.h - pad },
      270: { x: r.x + pad,       y: r.y + r.h },
    }[rot],
    size,
    rotate: rot,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all 21 tests pass. If a rotation case fails, re-derive: with rotation 90 (clockwise), the rendered image's left edge corresponds to the unrotated page's bottom edge and its top edge to the page's left edge, so `(px, py) → (py, px)`.

- [ ] **Step 5: Commit**

```bash
git add src/geometry.js test/geometry.test.js && git commit -m "feat: geometry conversion from rendered px to PDF points with rotation"
```

---

### Task 3: pdfView.js — render pages

**Files:**
- Create: `src/pdfView.js`
- Modify: `src/app.js`

- [ ] **Step 1: Implement pdfView.js**

```js
import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const TARGET_WIDTH = 800; // CSS px
const MAX_DPR = 2;        // beyond 2x the extra canvas pixels cost memory for no visible gain

// pdf.js 6 has no PDFDocumentProxy.destroy(); the loading task owns teardown (and the worker),
// so that is what we hold on to.
let currentTask = null; // the PDFDocumentLoadingTask behind the pages on screen
let loadSeq = 0;        // generation counter: only the newest loadPdf call may touch the container

/** Destroy the document currently on screen, freeing its worker and caches. Safe to call any time. */
export async function closePdf() {
  const task = currentTask;
  currentTask = null;
  if (task) await task.destroy().catch(() => {});
}

/**
 * Renders every page of `file` into `container`, one at a time, calling
 * `onPage(pageInfo, numPages)` as each page appears. Returns { bytes, pages } where
 * pages[i] = { index, el, canvas, viewport } and viewport matches the shape in geometry.js.
 *
 * `viewport.offsetX/offsetY` are the CropBox origin in points, usually (0, 0), which must be
 * added back when converting to PDF user space. UserUnit is assumed to be 1 (the default);
 * a page that sets /UserUnit would render at the right size but export at the wrong one.
 *
 * Only the most recent call may write to `container`: a superseded call cancels its render and
 * throws Error('superseded'), which the caller should ignore.
 *
 * Errors: Error('encrypted') for a password-protected file and Error('invalid') for one that
 * will not parse — both thrown before anything is touched, so whatever was open stays open.
 * Error('render-failed') means the container was already cleared and there is nothing left on
 * screen. Error('superseded') means a newer call has taken over.
 */
export async function loadPdf(file, container, onPage) {
  const seq = ++loadSeq;
  const abortIfSuperseded = (task) => {
    if (seq === loadSeq) return;
    task?.cancel?.();
    throw new Error('superseded');
  };

  // Parse before touching anything: a file that turns out not to be a PDF must leave the
  // document already on screen exactly as it was.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    if (err?.name === 'PasswordException') throw new Error('encrypted');
    throw new Error('invalid');
  }
  if (seq !== loadSeq) { await loadingTask.destroy().catch(() => {}); throw new Error('superseded'); }

  // Take ownership synchronously, so a concurrent load can never destroy the task we are about
  // to render: no await between the generation check above and this assignment.
  const previous = currentTask;
  currentTask = loadingTask;
  if (previous) await previous.destroy().catch(() => {});
  abortIfSuperseded(); // the destroy above was an await window

  container.innerHTML = '';
  const pages = [];
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      abortIfSuperseded();
      const rotation = ((page.rotate % 360) + 360) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const scale = TARGET_WIDTH / base.width;
      const vp = page.getViewport({ scale, rotation });
      const unrot = page.getViewport({ scale: 1, rotation: 0 }); // unrotated page size in points

      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.page = String(i - 1);
      el.style.width = `${vp.width}px`;
      el.style.height = `${vp.height}px`;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width * dpr);
      canvas.height = Math.round(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      el.appendChild(canvas);
      container.appendChild(el);

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const task = page.render({ canvasContext: ctx, viewport: vp });
      await task.promise;
      abortIfSuperseded(task);
      page.cleanup();

      const info = {
        index: i - 1, el, canvas,
        viewport: {
          scale, rotation, width: vp.width, height: vp.height,
          pdfWidth: unrot.width, pdfHeight: unrot.height,
          offsetX: unrot.viewBox[0], offsetY: unrot.viewBox[1],
        },
      };
      pages.push(info);
      onPage?.(info, doc.numPages);
    }
  } catch (err) {
    if (seq !== loadSeq || err?.message === 'superseded') throw new Error('superseded');
    // The container was already cleared, so there is nothing to keep: fall back to empty.
    container.innerHTML = '';
    currentTask = null;
    await loadingTask.destroy().catch(() => {});
    throw new Error('render-failed');
  }
  return { bytes, pages };
}
```

Notes on the pdf.js 6 API:
- It transfers the `data` buffer to the worker, hence `bytes.slice()` so we keep our own copy for pdf-lib.
- `PDFDocumentProxy` has **no** `destroy()`; teardown (and terminating the worker) lives on the `PDFDocumentLoadingTask` returned by `getDocument()`, so keep the task, not just the proxy. Without this every re-open leaks a worker.
- `page.getViewport(...)` returns a `PageViewport` whose `viewBox` is the raw CropBox array (`page.view`) and whose `width`/`height` are already multiplied by `/UserUnit`. We assume UserUnit 1 and take the CropBox origin from `viewBox[0]`/`viewBox[1]`.

- [ ] **Step 2: Wire file open + drag/drop in app.js**

Replace `src/app.js` with:

```js
import { showToast } from './toast.js';
import { loadPdf, closePdf } from './pdfView.js';

const $ = (id) => document.getElementById(id);
const state = { file: null, bytes: null, pages: [] };
const EDIT_BUTTONS = ['btn-add-signature', 'btn-add-date', 'btn-add-text', 'btn-save'];

let loading = false;

const setEditingEnabled = (on) => { for (const id of EDIT_BUTTONS) $(id).disabled = !on; };

/** Back to "no document open": empty page list, drop zone visible, nothing to edit or save. */
function showEmptyState() {
  $('pages').hidden = true;
  $('pages').innerHTML = '';
  $('drop-zone').hidden = false;
  $('file-name').textContent = '';
  Object.assign(state, { file: null, bytes: null, pages: [] });
  setEditingEnabled(false);
}

async function openFile(file) {
  if (!file) return;
  // Second opens are rejected while loading, so loadPdf's supersede path is defence-in-depth only.
  if (loading) { showToast('Still loading the previous PDF…'); return; }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('That is not a PDF.'); return;
  }
  loading = true;
  setEditingEnabled(false); // no editing or saving while a load is in flight
  // Nothing else on screen changes until the first page renders, so a file that fails to
  // parse leaves the document already open untouched.
  let shown = false;
  try {
    const { bytes, pages } = await loadPdf(file, $('pages'), (page, numPages) => {
      if (!shown) {
        shown = true;
        $('drop-zone').hidden = true;
        $('pages').hidden = false;
      }
      $('file-name').textContent = `${file.name} — loading page ${page.index + 1}/${numPages}…`;
    });
    Object.assign(state, { file, bytes, pages });
    $('file-name').textContent = file.name;
    setEditingEnabled(true);
  } catch (err) {
    if (err?.message === 'superseded') return; // a newer load owns the container now
    if (err?.message === 'render-failed') {
      await closePdf(); // loadPdf already tore the document down; make sure of it
      showEmptyState();
      showToast("Couldn't render this PDF.");
      return;
    }
    // 'encrypted' / 'invalid': nothing was touched, so hand the previous document back.
    setEditingEnabled(!!state.file);
    showToast(err.message === 'encrypted'
      ? "Couldn't open this PDF (it's password-protected)."
      : "Couldn't open this PDF (encrypted or corrupted).");
  } finally {
    loading = false;
  }
}

$('btn-open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so re-picking the same file still fires `change`
  openFile(file);
});

// Drag highlight via a depth counter: dragenter/dragleave also fire for every child element,
// so a plain add/remove pair flickers as the pointer crosses the page.
const dz = $('drop-zone');
let dragDepth = 0;
const paintDrag = () => dz.classList.toggle('over', dragDepth > 0);
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; paintDrag(); });
document.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); paintDrag(); });
document.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragend', () => { dragDepth = 0; paintDrag(); }); // drag abandoned, no drop
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; paintDrag();
  const files = e.dataTransfer?.files ?? [];
  if (files.length > 1) showToast('One PDF at a time.');
  openFile(files[0]);
});

export { state };
```

- [ ] **Step 3: Verify in browser**

Start server, open the page, drop any PDF: pages render at 800px wide, stacked, appearing one at a time while the toolbar shows `name — loading page n/N…`. Open a second PDF: its pages replace the first and the previous document's worker is destroyed. Re-pick the same file from the picker: it reloads (the input value is cleared). Drag over the page: the highlight must not flicker as the pointer crosses child elements. Drop a `.txt` renamed `.pdf` with nothing open: toast "Couldn't open this PDF (encrypted or corrupted)." and the drop zone stays. Drop the same file **with a PDF already open**: the toast appears and that document stays on screen untouched — parsing happens before anything is cleared. Console must be clean of errors (a worker-load error means the `workerSrc` URL is wrong).

- [ ] **Step 4: Commit**

```bash
git add src/pdfView.js src/app.js && git commit -m "feat: render PDF pages with pdf.js, file open and drag-drop"
```

---

### Task 4: signaturePad.js — draw / upload / persist

**Files:**
- Create: `src/signaturePad.js`
- Modify: `src/app.js`

- [ ] **Step 1: Implement signaturePad.js**

```js
import { showToast } from './toast.js';

const KEY = 'pdf-signer:signature';

let pending = null; // the in-flight modal promise, so a second open can't stack a second set of listeners

export function getSavedSignature() {
  return localStorage.getItem(KEY);
}

/**
 * Opens the modal. Resolves with a PNG data URL (also persisted) or null if cancelled.
 * Called again while the modal is open, it hands back the same promise.
 */
export function openSignaturePad() {
  if (pending) return pending;

  const modal = document.getElementById('sig-modal');
  const canvas = document.getElementById('sig-canvas');
  // Backing store at device resolution. CSS pins the width and the intrinsic aspect ratio is
  // unchanged, so the pad still lays out at 600x220 CSS px but strokes are no longer soft.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = 600 * dpr; canvas.height = 220 * dpr;
  const ctx = canvas.getContext('2d');
  const widthInput = document.getElementById('sig-width');
  let hasInk = false;

  const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; };
  clear();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';

  // Backing-store pixels per CSS pixel: the canvas is CSS-scaled, so both pointer
  // coordinates and the pen width have to be converted through it.
  const ratio = () => canvas.width / canvas.getBoundingClientRect().width;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect(), k = ratio();
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  let drawing = false, last = null, prevMid = null;
  const down = (e) => { drawing = true; last = pos(e); prevMid = last; canvas.setPointerCapture(e.pointerId); };
  const move = (e) => {
    if (!drawing) return;
    const p = pos(e);
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.lineWidth = parseFloat(widthInput.value) * ratio();
    ctx.beginPath(); ctx.moveTo(prevMid.x, prevMid.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.stroke();
    last = p; prevMid = mid; hasInk = true;
  };
  // Midpoint smoothing always lags one sample behind, so close the gap to where the pointer
  // actually lifted. A tap that never moved becomes a zero-length path, which the round cap
  // renders as a dot.
  const up = () => {
    if (drawing) {
      ctx.lineWidth = parseFloat(widthInput.value) * ratio();
      ctx.beginPath(); ctx.moveTo(prevMid.x, prevMid.y); ctx.lineTo(last.x, last.y); ctx.stroke();
      hasInk = true;
    }
    drawing = false;
  };

  const onUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onerror = () => showToast("Couldn't read that image.");
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => showToast("Couldn't read that image.");
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const s = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * s, h = img.height * s;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        knockoutBackground(ctx, canvas.width, canvas.height);
        hasInk = true;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  pending = new Promise((resolve) => {
    const cancel = () => { cleanup(); resolve(null); };
    const onKeydown = (e) => { if (e.key === 'Escape') cancel(); };
    const cleanup = () => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      document.getElementById('sig-clear').onclick = null;
      document.getElementById('sig-upload').onchange = null;
      document.getElementById('sig-upload-btn').onclick = null;
      document.getElementById('sig-cancel').onclick = null;
      document.getElementById('sig-save').onclick = null;
      document.removeEventListener('keydown', onKeydown);
      modal.hidden = true;
      pending = null;
    };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    document.getElementById('sig-clear').onclick = clear;
    document.getElementById('sig-upload').onchange = onUpload;
    document.getElementById('sig-upload-btn').onclick = () => document.getElementById('sig-upload').click();
    document.getElementById('sig-cancel').onclick = cancel;
    document.getElementById('sig-save').onclick = () => {
      if (!hasInk) { showToast('Draw or upload a signature first.'); return; }
      const dataUrl = trimmedPng(canvas);
      try {
        localStorage.setItem(KEY, dataUrl);
      } catch {
        showToast('Signature used for this session, but could not be saved for next time.');
      }
      cleanup(); resolve(dataUrl);
    };
    document.addEventListener('keydown', onKeydown);
    modal.hidden = false;
    document.getElementById('sig-save').focus();
  });
  return pending;
}

/**
 * An uploaded signature is usually dark ink on white paper. Map luminance to alpha so the paper
 * drops out and the ink takes the pad's own colour, leaving grey edge pixels as soft antialiasing.
 */
function knockoutBackground(ctx, w, h) {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // leave the margins the fit never painted alone
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = 17;
    d[i + 3] = Math.max(0, Math.min(255, Math.round((235 - lum) * 255 / 180)));
  }
  ctx.putImageData(image, 0, 0);
}

/** Crop transparent margins so the saved signature has a tight bounding box. */
function trimmedPng(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return canvas.toDataURL('image/png');
  const pad = 6;
  const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
  const sw = Math.min(width, maxX + 1 + pad) - sx, sh = Math.min(height, maxY + 1 + pad) - sy;
  const out = document.createElement('canvas'); out.width = sw; out.height = sh;
  out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL('image/png');
}
```

- [ ] **Step 2: Wire the Sign button in app.js**

Add to `src/app.js` (below the imports add `import { openSignaturePad } from './signaturePad.js';`, and at the bottom):

```js
$('btn-sign').addEventListener('click', async () => {
  const sig = await openSignaturePad();
  if (sig) showToast('Signature saved.');
});
```

- [ ] **Step 3: Verify in browser**

Click Sign → draw → Save: toast appears; `localStorage.getItem('pdf-signer:signature')` in DevTools starts with `data:image/png`. Cancel resolves without saving. Upload a PNG: it appears fitted in the canvas and saving stores it. Strokes must be smooth with no gaps at fast trackpad speed.

- [ ] **Step 4: Commit**

```bash
git add src/signaturePad.js src/app.js && git commit -m "feat: signature pad with draw, upload, trim and localStorage persistence"
```

---

### Task 5: overlays.js — place, drag, resize, edit, delete

**Files:**
- Create: `src/overlays.js`
- Modify: `src/app.js`

- [ ] **Step 1: Implement overlays.js**

```js
import { FONT_SIZE_RATIO } from './geometry.js';

const overlays = [];   // model, see plan header
let selectedId = null;
let nextId = 1;
let globalsInit = false;

export function getOverlays() { return overlays.map(o => ({ ...o })); }

export function removeOverlay(id) {
  const i = overlays.findIndex(o => o.id === id);
  if (i < 0) return;
  overlays[i].el.remove();
  overlays.splice(i, 1);
  if (selectedId === id) selectedId = null;
}

export function removeSelected() { if (selectedId) removeOverlay(selectedId); }

/** Blur any edit still in progress so its text is committed to the model. Call before reading. */
export function commitEdits() {
  for (const o of overlays) if (o.el.contentEditable === 'true') o.el.blur();
}

/** Drop every overlay: their page elements belong to a document that is being replaced. */
export function clearOverlays() {
  for (const o of overlays) o.el.remove();
  overlays.length = 0;
  deselect();
}

/**
 * type: 'signature' | 'date' | 'text'
 * pageInfo: { index, el, viewport } from pdfView
 * value: dataURL for signature, initial text otherwise
 * imgAspect: width/height of the signature image (signature only)
 */
export function addOverlay(type, pageInfo, value, imgAspect = 3) {
  const pw = pageInfo.viewport.width, ph = pageInfo.viewport.height;
  let w, h;
  if (type === 'signature') { w = Math.min(180, pw * 0.4); h = w / imgAspect; }
  else { h = 22; w = type === 'date' ? 110 : 160; }
  // pageW/pageH come from the viewport, not the live element, so clamping survives a re-layout.
  const o = { id: `o${nextId++}`, page: pageInfo.index, type, x: (pw - w) / 2, y: (ph - h) / 2, w, h, value,
              aspect: imgAspect, pageW: pw, pageH: ph };

  const el = document.createElement('div');
  el.className = `overlay ${type}`;
  el.dataset.id = o.id;
  if (type === 'signature') {
    const img = document.createElement('img'); img.src = value; img.draggable = false; el.appendChild(img);
  } else {
    el.contentEditable = 'false';
    el.textContent = value;
    el.spellcheck = false;
  }
  const handle = document.createElement('div'); handle.className = 'handle'; el.appendChild(handle);
  pageInfo.el.appendChild(el);
  o.el = el;
  overlays.push(o);
  layout(o);
  if (type !== 'signature') { fitText(o); o.x = Math.max(0, (pw - o.w) / 2); layout(o); }
  attach(o, handle);
  select(o.id);
  return o.id;
}

function layout(o) {
  Object.assign(o.el.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  if (o.type !== 'signature') o.el.style.fontSize = `${o.h * FONT_SIZE_RATIO}px`;
}

function clamp(o) {
  o.x = Math.max(0, Math.min(o.x, o.pageW - o.w));
  o.y = Math.max(0, Math.min(o.y, o.pageH - o.h));
}

/**
 * A text box is as wide as its glyphs: the handle sets the height (font size) and the width
 * follows. Measured at `max-content` because scrollWidth never reports less than the width
 * already set, so the box could grow but never shrink back; the out-of-flow handle does not
 * count towards it. Rounded up so overflow:hidden can never clip the last glyph.
 */
function fitText(o) {
  layout(o); // font size first, so the measurement uses the new one
  o.el.style.width = 'max-content';
  o.w = Math.max(12, Math.ceil(o.el.getBoundingClientRect().width)); // 12: room for the caret when empty
  clamp(o);
  layout(o);
}

function select(id) {
  selectedId = id;
  for (const o of overlays) o.el.classList.toggle('selected', o.id === id);
}
export function deselect() { select(null); }

/** Follow one pointer gesture on the element that received it, capture and cancellation included. */
function trackPointer(el, e, move) {
  try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone: capture is optional */ }
  const stop = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', stop);
    el.removeEventListener('pointercancel', stop);
    el.removeEventListener('lostpointercapture', stop);
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
}

function attach(o, handle) {
  // Drag to move
  o.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;                    // right/middle click must not start a drag
    if (o.el.contentEditable === 'true') return;   // editing text: let the caret work
    e.preventDefault();
    select(o.id);
    const r0 = o.el.parentElement.getBoundingClientRect();
    const grabDx = e.clientX - r0.left - o.x, grabDy = e.clientY - r0.top - o.y;
    // Re-read the page rect every move: scrolling mid-drag must not teleport the overlay.
    const move = (ev) => {
      const r = o.el.parentElement.getBoundingClientRect();
      o.x = ev.clientX - r.left - grabDx;
      o.y = ev.clientY - r.top - grabDy;
      clamp(o); layout(o);
    };
    trackPointer(o.el, e, move);
  });

  // Drag handle to resize
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    select(o.id);
    const sx = e.clientX, sy = e.clientY, sw = o.w, sh = o.h;
    const move = (ev) => {
      if (o.type === 'signature') {
        o.w = Math.max(30, sw + (ev.clientX - sx)); o.h = o.w / o.aspect;
        if (o.w > o.pageW - o.x) { o.w = o.pageW - o.x; o.h = o.w / o.aspect; }
        if (o.h > o.pageH - o.y) { o.h = o.pageH - o.y; o.w = o.h * o.aspect; }
        clamp(o); layout(o);
      } else {
        o.h = Math.min(Math.max(10, sh + (ev.clientY - sy)), o.pageH - o.y);
        fitText(o); // height is the only free axis; the width follows the glyphs
        // Width is set by the font size, so the page is bounded by giving back height, never by
        // clipping the box: a clipped preview would not match the text the exporter draws.
        if (o.w > o.pageW) { o.h *= o.pageW / o.w; fitText(o); }
      }
    };
    trackPointer(handle, e, move);
  });

  // Double-click to edit text
  if (o.type !== 'signature') {
    o.el.addEventListener('dblclick', () => {
      o.el.contentEditable = 'true'; o.el.focus();
      document.getSelection()?.selectAllChildren(o.el);
    });
    o.el.addEventListener('input', () => fitText(o)); // grow as you type, so nothing is clipped
    o.el.addEventListener('paste', (e) => {
      e.preventDefault(); // rich clipboard content would drag markup into the box
      const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });
    o.el.addEventListener('blur', () => {
      o.el.contentEditable = 'false';
      const clean = o.el.textContent
        .replace(/\s+/g, ' ')                    // one line: pasted breaks and tabs become spaces
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')   // only what Helvetica/WinAnsi can encode, or the export throws
        .replace(/ {2,}/g, ' ')                  // close the gaps the strip left behind
        .trim();
      o.value = clean || o.value;
      o.el.textContent = o.value;
      o.el.appendChild(handle); // the handle is inside the editable box: editing drops it
      fitText(o);
    });
    o.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); o.el.blur(); } e.stopPropagation(); });
  }
}

/** Call once. Handles global deselect click and Delete/Backspace. */
export function initOverlayGlobals() {
  if (globalsInit) return;
  globalsInit = true;
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.overlay')) deselect(); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && document.activeElement?.contentEditable !== 'true'
        && document.getElementById('sig-modal').hidden) {
      e.preventDefault(); removeSelected();
    }
  });
}
```

Note: text overlays have no padding/border (CSS), so the model's w/h is exactly the glyph box that `exporter.js` maps to PDF.

- [ ] **Step 2: Wire buttons in app.js**

Add imports: `import { addOverlay, initOverlayGlobals, getOverlays, clearOverlays } from './overlays.js';` and `import { getSavedSignature } from './signaturePad.js';` (merge with the existing signaturePad import). In `openFile`, the overlays on screen belong to the outgoing document's page elements, so drop them in the first-`onPage` reveal block — a PDF that fails to parse never gets there and leaves the open document, overlays and all, untouched:

```js
      if (!shown) {
        shown = true;
        clearOverlays(); // they belong to the previous document's pages, which are gone
```

`showEmptyState` gains the same call — `clearOverlays(); // the pages they sat on are gone` — next to its `Object.assign(state, ...)`, so closing a document that failed to render leaves no orphans behind. Then add (`todayString` joins the existing `export { state };` list at the end of the file rather than being exported inline):

```js
initOverlayGlobals();

const DATE_KEY = 'pdf-signer:dateFormat';
let dateFormat = localStorage.getItem(DATE_KEY) || 'DMY';
const fmtBtn = $('btn-date-format');
const renderFmt = () => { fmtBtn.textContent = dateFormat === 'DMY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'; };
renderFmt();
fmtBtn.addEventListener('click', () => { dateFormat = dateFormat === 'DMY' ? 'MDY' : 'DMY'; localStorage.setItem(DATE_KEY, dateFormat); renderFmt(); });

function todayString() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear();
  return dateFormat === 'DMY' ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
}

/** The page whose centre is nearest the viewport centre, or null with no document open. */
function currentPage() {
  if (state.pages.length === 0) return null;
  const mid = window.innerHeight / 2;
  let best = state.pages[0], bestDist = Infinity;
  for (const p of state.pages) {
    const r = p.el.getBoundingClientRect();
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

/** Resolves null if the data URL will not decode, so we never place an invisible overlay. */
function imageAspect(dataUrl) {
  return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.width / i.height); i.onerror = () => resolve(null); i.src = dataUrl; });
}

$('btn-add-signature').addEventListener('click', async () => {
  const page = currentPage();
  if (!page) return;
  let sig = getSavedSignature();
  if (!sig) sig = await openSignaturePad();
  if (!sig) return;
  const aspect = await imageAspect(sig);
  if (aspect == null) { showToast('Saved signature image is unreadable — draw a new one.'); return; }
  addOverlay('signature', page, sig, aspect);
});
$('btn-add-date').addEventListener('click', () => { const page = currentPage(); if (page) addOverlay('date', page, todayString()); });
$('btn-add-text').addEventListener('click', () => { const page = currentPage(); if (page) addOverlay('text', page, 'Text'); });

export { state, todayString };
```

- [ ] **Step 3: Verify in browser**

Open a multi-page PDF, scroll to page 2, click + Signature: it appears centred on page 2, selected. Drag it; it can't leave the page. Resize keeps aspect. + Date shows today's date; toggling format then adding another date changes format. + Text → double-click → type → Enter commits. Delete key removes the selected overlay; Backspace while editing text does NOT delete the overlay. Clicking on the page background deselects. Opening a second PDF clears every overlay; a file that fails to parse leaves them alone. A 25-character name widens the box to fit with nothing clipped, and resizing a text overlay taller grows the font with the width following the glyphs. Right-clicking an overlay does not start a drag, and scrolling the wheel mid-drag leaves the overlay under the pointer. Pasting multi-line text lands as one line.

- [ ] **Step 4: Commit**

```bash
git add src/overlays.js src/app.js && git commit -m "feat: draggable, resizable, editable overlays for signature, date and text"
```

---

### Task 6: exporter.js — burn overlays into the PDF

**Files:**
- Create: `src/exporter.js`
- Modify: `src/app.js`

- [ ] **Step 1: Implement exporter.js**

Use `viewport.pdfWidth`/`pdfHeight`/`offsetX`/`offsetY` as the source of truth — never pdf-lib's `page.getSize()`, which is the MediaBox. pdf.js renders the CropBox, so on a cropped page the two differ and every overlay would land offset.

```js
import { toPdfRect, textLayout, imageLayout } from './geometry.js';

/**
 * bytes: Uint8Array of the original PDF (never modified)
 * overlays: from getOverlays()
 * pages: from loadPdf (need .viewport per index)
 * failures: optional array — overlays that could not be drawn are pushed here and skipped,
 *   so one bad item cannot cost the user every other signature on the document.
 * Returns Uint8Array of the signed PDF.
 *
 * Page geometry comes from `viewport.pdfWidth/pdfHeight/offsetX/offsetY`, never pdf-lib's
 * page.getSize(), which is the MediaBox: pdf.js renders the CropBox, so on a cropped page the
 * two differ and every overlay would land offset. Rotation lives entirely in geometry.js.
 */
export async function buildSignedPdf(bytes, overlays, pages, failures = []) {
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pdfPages = doc.getPages();
  const imageCache = new Map(); // one XObject per distinct signature, however many times it is placed

  for (const o of overlays) {
    try {
      const page = pdfPages[o.page];
      const vp = pages[o.page].viewport;
      const r = toPdfRect({ x: o.x, y: o.y, w: o.w, h: o.h }, vp);
      if (o.type === 'signature') {
        let img = imageCache.get(o.value);
        if (!img) { img = await doc.embedPng(o.value); imageCache.set(o.value, img); }
        const l = imageLayout(r, vp.rotation);
        page.drawImage(img, { x: l.x, y: l.y, width: l.width, height: l.height, rotate: degrees(l.rotate) });
      } else {
        const l = textLayout(r, vp.rotation);
        page.drawText(o.value, { x: l.x, y: l.y, size: l.size, font, color: rgb(0, 0, 0), rotate: degrees(l.rotate) });
      }
    } catch (err) {
      console.error('Could not draw overlay', o.id, err);
      failures.push({ id: o.id, type: o.type, error: err });
    }
  }
  // One tick: the Save button is disabled for the whole export, so yielding buys nothing.
  return doc.save({ objectsPerTick: Infinity });
}

/**
 * pdf-lib's "this document is encrypted" error. The vendored bundle is minified, so every error
 * class reports `name === 'Error'`: identify it by constructor, with the message as a fallback.
 */
export function isEncryptedPdfError(err) {
  const Ctor = window.PDFLib.EncryptedPDFError;
  return (!!Ctor && err instanceof Ctor) || /is encrypted/.test(err?.message ?? '');
}

/**
 * False only for a PDF pdf-lib refuses to open at all: owner-password ("restricted") files,
 * which pdf.js renders happily and pdf-lib rejects as encrypted. Any other load failure returns
 * true and is left to surface at export time with its own message.
 */
export async function canEditPdf(bytes) {
  const { PDFDocument } = window.PDFLib;
  try {
    await PDFDocument.load(bytes, { ignoreEncryption: false });
    return true;
  } catch (err) {
    return !isEncryptedPdfError(err);
  }
}

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function signedName(original) {
  return original.replace(/\.pdf$/i, '') + '-signed.pdf';
}
```

Rotation handling is entirely inside geometry.js (unit-tested). If Task 7's visual check on rotated90.pdf is wrong, fix `imageLayout`/`textLayout` and their tests, not the exporter.

- [ ] **Step 2: Wire Save in app.js**

Add `import { buildSignedPdf, downloadBytes, signedName, canEditPdf, isEncryptedPdfError } from './exporter.js';`, add `commitEdits` to the `overlays.js` import, guard `openFile` right after `loadPdf` resolves with `if (!(await canEditPdf(bytes))) { await closePdf(); showEmptyState(); showToast('This PDF has security restrictions that prevent editing.'); return; }` (pdf.js renders owner-password PDFs that pdf-lib refuses to open), and:

```js
$('btn-save').addEventListener('click', async () => {
  commitEdits(); // an edit still in progress must reach the model before we read it
  const overlays = getOverlays();
  if (overlays.length === 0) { showToast('Nothing to save — add a signature first.'); return; }
  const name = signedName(state.file.name); // read before the await: the document may be gone after it
  $('btn-save').disabled = true;
  try {
    const failures = [];
    const out = await buildSignedPdf(state.bytes, overlays, state.pages, failures);
    downloadBytes(out, name);
    if (failures.length) showToast(`Saved signed PDF — ${failures.length} item(s) could not be drawn.`, 8000);
    else showToast('Saved signed PDF to Downloads.');
  } catch (err) {
    console.error(err);
    showToast(isEncryptedPdfError(err)
      ? 'This PDF has security restrictions that prevent editing.'
      : `Export failed: ${String(err?.message ?? err)}`);
  } finally {
    $('btn-save').disabled = !state.file; // the document may have been closed while we were saving
  }
});
```

- [ ] **Step 3: Verify in browser**

Place a signature, a date and a text on page 1 of any portrait PDF; Save. Open `~/Downloads/<name>-signed.pdf` in Preview: items appear exactly where placed, same size, signature transparent background, text is black Helvetica. Original file unchanged (check its mtime).

- [ ] **Step 4: Commit**

```bash
git add src/exporter.js src/app.js && git commit -m "feat: export signed PDF with pdf-lib"
```

---

### Task 7: Sample PDFs, rotation verification, README checklist

**Files:**
- Create: `samples/make-samples.mjs`, `samples/portrait.pdf`, `samples/landscape.pdf`, `samples/rotated90.pdf`
- Modify: `README.md`, `src/geometry.js` (only if rotated output is wrong)

- [ ] **Step 1: Sample generator (uses the vendored pdf-lib UMD bundle from node)**

```js
// node samples/make-samples.mjs
// package.json has "type":"module", so node would treat the vendored UMD .js as ESM
// (ReferenceError: self is not defined). Evaluate it as CommonJS explicitly instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const umd = readFileSync(join(here, '../vendor/pdf-lib.min.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', 'self', umd)(mod, mod.exports, globalThis);
const { PDFDocument, StandardFonts, degrees, rgb } = mod.exports;

async function make(name, { width, height, rotate = 0, pages = 2 }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([width, height]);
    if (rotate) p.setRotation(degrees(rotate));
    // Border first (pdf-lib fills rectangles black by default — set an explicit white fill).
    p.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderWidth: 1, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0) });
    p.drawText(`${name} — page ${i}`, { x: 40, y: height - 60, size: 20, font });
    p.drawText('Signature: ______________________   Date: __________', { x: 40, y: 80, size: 12, font });
  }
  writeFileSync(join(here, `${name}.pdf`), await doc.save());
  console.log('wrote', `${name}.pdf`);
}

await make('portrait', { width: 595, height: 842 });
await make('landscape', { width: 842, height: 595 });
await make('rotated90', { width: 595, height: 842, rotate: 90 });
```

Run: `npm run samples` → three PDFs written. Open `rotated90.pdf` in Preview: it should display landscape with the text rotated (reading top-to-bottom). That is the intended tricky case.

- [ ] **Step 2: Verify rotated export**

In the app, open `samples/rotated90.pdf`, place a signature over the "Signature:" line, and a date over "Date:", save, open in Preview. The items must sit on those lines, upright relative to the page text. If not, adjust `imageLayout`/`textLayout` in `src/geometry.js` and their tests (see rotation note in Task 6) until correct, and re-test 0° with `portrait.pdf` to be sure nothing regressed. Do the same with `landscape.pdf` (rotation 0, wide page).

- [ ] **Step 3: README manual checklist**

Append to `README.md`:

```markdown
## Manual test checklist
Run `npm run samples` first.

| # | Steps | Expected |
|---|-------|----------|
| 1 | Open `samples/portrait.pdf` | Two pages render, 800px wide |
| 2 | Sign → draw → Save | Toast "Signature saved."; survives reload |
| 3 | Scroll to page 2, + Signature | Appears centred on page 2, selected |
| 4 | Drag to a corner; drag past edge | Stays inside the page |
| 5 | Resize via blue handle | Aspect ratio preserved |
| 6 | + Date, toggle format, + Date again | Two dates, different formats |
| 7 | + Text, double-click, type "Chris", Enter | Text updated; Backspace while editing does not delete box |
| 8 | Select overlay, press Delete | Removed |
| 9 | Save signed PDF, open in Preview | Items at placed positions/sizes; original untouched |
| 10 | Repeat 3–9 with `samples/landscape.pdf` | Same |
| 11 | Repeat 3–9 with `samples/rotated90.pdf` | Items upright and correctly placed |
| 12 | Open a password-protected PDF | Toast: password-protected message |
| 13 | Open a 100-page PDF | Renders progressively; scrolling stays usable |
| 14 | With a PDF open, drop a corrupt `.pdf` | Toast; the open document and its overlays remain |
```

- [ ] **Step 4: Run unit tests one last time, commit**

Run: `npm test` → all pass.

```bash
git add -A && git commit -m "feat: sample PDFs, rotation verification and manual test checklist"
```
