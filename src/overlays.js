const overlays = [];   // model, see plan header
let selectedId = null;
let nextId = 1;

export function getOverlays() { return overlays.map(o => ({ ...o })); }

export function removeOverlay(id) {
  const i = overlays.findIndex(o => o.id === id);
  if (i < 0) return;
  overlays[i].el.remove();
  overlays.splice(i, 1);
  if (selectedId === id) selectedId = null;
}

export function removeSelected() { if (selectedId) removeOverlay(selectedId); }

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
  const o = { id: `o${nextId++}`, page: pageInfo.index, type, x: (pw - w) / 2, y: (ph - h) / 2, w, h, value, aspect: imgAspect };

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
  attach(o, handle);
  select(o.id);
  return o.id;
}

function layout(o) {
  Object.assign(o.el.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  if (o.type !== 'signature') o.el.style.fontSize = `${o.h * 0.8}px`;
}

function select(id) {
  selectedId = id;
  for (const o of overlays) o.el.classList.toggle('selected', o.id === id);
}
export function deselect() { select(null); }

function attach(o, handle) {
  const clamp = () => {
    const pw = o.el.parentElement.clientWidth, ph = o.el.parentElement.clientHeight;
    o.x = Math.max(0, Math.min(o.x, pw - o.w));
    o.y = Math.max(0, Math.min(o.y, ph - o.h));
  };

  // Drag to move
  o.el.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    if (o.el.contentEditable === 'true') return; // editing text: let the caret work
    e.preventDefault();
    select(o.id);
    const sx = e.clientX - o.x, sy = e.clientY - o.y;
    const move = (ev) => { o.x = ev.clientX - sx; o.y = ev.clientY - sy; clamp(); layout(o); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  // Drag handle to resize
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    select(o.id);
    const sx = e.clientX, sy = e.clientY, sw = o.w, sh = o.h;
    const move = (ev) => {
      if (o.type === 'signature') { o.w = Math.max(30, sw + (ev.clientX - sx)); o.h = o.w / o.aspect; }
      else { o.h = Math.max(10, sh + (ev.clientY - sy)); o.w = Math.max(30, sw + (ev.clientX - sx)); }
      clamp(); layout(o);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  // Double-click to edit text
  if (o.type !== 'signature') {
    o.el.addEventListener('dblclick', () => {
      o.el.contentEditable = 'true'; o.el.focus();
      document.getSelection()?.selectAllChildren(o.el);
    });
    o.el.addEventListener('blur', () => {
      o.el.contentEditable = 'false';
      o.value = o.el.textContent.trim() || o.value;
      o.el.textContent = o.value;
      o.el.appendChild(handle); // the handle is inside the editable box: editing drops it
    });
    o.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); o.el.blur(); } e.stopPropagation(); });
  }
}

/** Call once. Handles global deselect click and Delete/Backspace. */
export function initOverlayGlobals() {
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.overlay')) deselect(); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && document.activeElement?.contentEditable !== 'true'
        && document.getElementById('sig-modal').hidden) {
      e.preventDefault(); removeSelected();
    }
  });
}
