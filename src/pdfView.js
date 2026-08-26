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
  if (task) await task.destroy();
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
 * Throws Error('encrypted') for password-protected files, Error('invalid') otherwise.
 */
export async function loadPdf(file, container, onPage) {
  const seq = ++loadSeq;
  const abortIfSuperseded = (task) => {
    if (seq === loadSeq) return;
    task?.cancel?.();
    throw new Error('superseded');
  };

  await closePdf();

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
  if (seq !== loadSeq) { await loadingTask.destroy(); throw new Error('superseded'); }
  currentTask = loadingTask;

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
    container.innerHTML = '';
    currentTask = null;
    await loadingTask.destroy().catch(() => {});
    throw new Error('invalid');
  }
  return { bytes, pages };
}
