const KEY = 'pdf-signer:signature';

export function getSavedSignature() {
  return localStorage.getItem(KEY);
}

/**
 * Opens the modal. Resolves with a PNG data URL (also persisted) or null if cancelled.
 */
export function openSignaturePad() {
  const modal = document.getElementById('sig-modal');
  const canvas = document.getElementById('sig-canvas');
  const ctx = canvas.getContext('2d');
  const widthInput = document.getElementById('sig-width');
  let hasInk = false;

  const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; };
  clear();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';

  // Pointer → canvas coords (canvas is CSS-scaled)
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
  };

  let drawing = false, last = null, prevMid = null;
  const down = (e) => { drawing = true; last = pos(e); prevMid = last; canvas.setPointerCapture(e.pointerId); };
  const move = (e) => {
    if (!drawing) return;
    const p = pos(e);
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.lineWidth = parseFloat(widthInput.value) * (canvas.width / canvas.getBoundingClientRect().width);
    ctx.beginPath(); ctx.moveTo(prevMid.x, prevMid.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.stroke();
    last = p; prevMid = mid; hasInk = true;
  };
  const up = () => { drawing = false; };

  const onUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const s = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * s, h = img.height * s;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        hasInk = true;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  return new Promise((resolve) => {
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
    };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    document.getElementById('sig-clear').onclick = clear;
    document.getElementById('sig-upload').onchange = onUpload;
    document.getElementById('sig-upload-btn').onclick = () => document.getElementById('sig-upload').click();
    document.getElementById('sig-cancel').onclick = cancel;
    document.getElementById('sig-save').onclick = () => {
      if (!hasInk) return;
      const dataUrl = trimmedPng(canvas);
      localStorage.setItem(KEY, dataUrl);
      cleanup(); resolve(dataUrl);
    };
    document.addEventListener('keydown', onKeydown);
    modal.hidden = false;
    document.getElementById('sig-save').focus();
  });
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
