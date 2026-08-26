import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const TARGET_WIDTH = 800; // CSS px

/**
 * Renders every page of `file` into #pages. Returns { bytes, pages } where
 * pages[i] = { index, el, canvas, viewport } and viewport matches the shape in geometry.js.
 * Throws Error('encrypted') for password-protected files, Error('invalid') otherwise.
 */
export async function loadPdf(file, container) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('encrypted');
    throw new Error('invalid');
  }
  container.innerHTML = '';
  const pages = [];
  const dpr = window.devicePixelRatio || 1;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const rotation = ((page.rotate % 360) + 360) % 360;
    const base = page.getViewport({ scale: 1, rotation });
    const scale = TARGET_WIDTH / base.width;
    const vp = page.getViewport({ scale, rotation });

    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i - 1);
    el.style.width = `${vp.width}px`;
    el.style.height = `${vp.height}px`;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    el.appendChild(canvas);
    container.appendChild(el);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    // Unrotated page size in points:
    const unrot = page.getViewport({ scale: 1, rotation: 0 });
    pages.push({
      index: i - 1, el, canvas,
      viewport: { scale, rotation, width: vp.width, height: vp.height, pdfWidth: unrot.width, pdfHeight: unrot.height },
    });
  }
  return { bytes, pages };
}
