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
