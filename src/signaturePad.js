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
