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
  return doc.save();
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
