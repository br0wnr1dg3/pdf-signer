import { showToast } from './toast.js';
import { loadPdf } from './pdfView.js';

const $ = (id) => document.getElementById(id);
const state = { file: null, bytes: null, pages: [] };

async function openFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('That is not a PDF.'); return;
  }
  try {
    const { bytes, pages } = await loadPdf(file, $('pages'));
    Object.assign(state, { file, bytes, pages });
    $('drop-zone').hidden = true;
    $('pages').hidden = false;
    $('file-name').textContent = file.name;
    for (const id of ['btn-add-signature', 'btn-add-date', 'btn-add-text', 'btn-save']) $(id).disabled = false;
  } catch (err) {
    showToast(err.message === 'encrypted'
      ? "Couldn't open this PDF (it's password-protected)."
      : "Couldn't open this PDF (encrypted or corrupted).");
  }
}

$('btn-open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => openFile(e.target.files[0]));

const dz = $('drop-zone');
for (const ev of ['dragenter', 'dragover']) document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); });
document.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));

export { state };
