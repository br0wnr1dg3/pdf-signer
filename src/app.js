import { showToast } from './toast.js';
import { loadPdf, closePdf } from './pdfView.js';
import { openSignaturePad, getSavedSignature } from './signaturePad.js';
import { addOverlay, initOverlayGlobals, getOverlays, clearOverlays } from './overlays.js';

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
        clearOverlays(); // they belong to the previous document's pages, which are gone
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

$('btn-sign').addEventListener('click', async () => {
  const sig = await openSignaturePad();
  if (sig) showToast('Signature saved.');
});

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

/** The page whose centre is nearest the viewport centre. */
function currentPage() {
  const mid = window.innerHeight / 2;
  let best = state.pages[0], bestDist = Infinity;
  for (const p of state.pages) {
    const r = p.el.getBoundingClientRect();
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

function imageAspect(dataUrl) {
  return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.width / i.height); i.onerror = () => resolve(3); i.src = dataUrl; });
}

$('btn-add-signature').addEventListener('click', async () => {
  let sig = getSavedSignature();
  if (!sig) sig = await openSignaturePad();
  if (!sig) return;
  addOverlay('signature', currentPage(), sig, await imageAspect(sig));
});
$('btn-add-date').addEventListener('click', () => addOverlay('date', currentPage(), todayString()));
$('btn-add-text').addEventListener('click', () => addOverlay('text', currentPage(), 'Text'));

export { state, todayString };
