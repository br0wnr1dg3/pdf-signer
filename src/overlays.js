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
