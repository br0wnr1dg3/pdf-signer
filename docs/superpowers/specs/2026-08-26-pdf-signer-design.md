# PDF Signer — Design

**Date:** 2026-08-26
**Goal:** A local, offline, zero-install tool on macOS to place a hand-drawn signature, date, and short text onto any PDF and save a signed copy. Replaces Adobe/Preview for personal signing.

## Approach

Single static web page (`index.html` + `app.js` + `styles.css`) with vendored libraries:

- **pdf.js** (`vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs`) — renders pages to canvases.
- **pdf-lib** (`vendor/pdf-lib.min.js`) — embeds signature PNG and text into the original PDF bytes and produces the output.

No backend, no build step, no network. Opened via `python3 -m http.server` (needed because pdf.js uses ES modules and a worker, which `file://` blocks) — a one-line `open.command` launcher starts the server and opens the browser.

## Components

| Unit | Responsibility | Interface |
|---|---|---|
| `pdfView.js` | Load a `File`, render each page to a `<canvas>` inside `.page` wrappers, reporting each page as it appears; expose per-page viewport (scale, rotation, rendered size, unrotated page size and CropBox origin in PDF points). Destroys the previous document (and its worker) before loading the next, and ignores superseded loads. | `loadPdf(file, container, onPage?) → {bytes, pages: [{index, el, canvas, viewport}]}`, `closePdf()` |
| `signaturePad.js` | Modal with drawing canvas (pointer events, smoothed quadratic strokes, pen width, clear), image upload, save/cancel. Persists PNG data URL to `localStorage['pdf-signer:signature']`. | `openSignaturePad() → Promise<dataUrl|null>`, `getSavedSignature()` |
| `overlays.js` | Create/move/resize/edit/delete overlay elements (`signature`, `date`, `text`) positioned in CSS pixels relative to a page wrapper. Keeps a model array `{id, page, type, x, y, w, h, value}`. | `addOverlay(type, pageInfo, value, imgAspect?)`, `getOverlays()`, `removeOverlay(id)`, `removeSelected()`, `clearOverlays()`, `deselect()`, `initOverlayGlobals()` |
| `geometry.js` | Pure functions: CSS-pixel rect on a rendered page → PDF-point rect (flip Y, divide by scale, handle page rotation 0/90/180/270). No DOM. | `toPdfRect(rect, viewport) → {x, y, w, h}` |
| `exporter.js` | Uses pdf-lib: load original bytes, for each overlay embed PNG or draw Helvetica text at `toPdfRect(...)`, save, trigger download `<name>-signed.pdf`. | `buildSignedPdf(bytes, overlays, pages) → Uint8Array`, `downloadBytes(bytes, filename)`, `signedName(original)` |
| `app.js` | Wires UI: file input/drag-drop, toolbar buttons (Sign, Add signature, Add date, Add text, Save), keyboard (Delete removes selected overlay). | — |

## Data flow

1. User drops a PDF → `pdfView.loadPdf` renders pages at a fixed display scale (fit to ~800px width, devicePixelRatio-aware).
2. "Sign" → `signaturePad` → PNG stored in `localStorage`. Reused on later visits.
3. "Add signature" places the saved PNG on the currently visible page at a default size (~180px wide, aspect preserved). "Add date" inserts today's date (DD/MM/YYYY default; toggle to MM/DD/YYYY in toolbar; persisted in `localStorage`). "Add text" inserts an editable box.
4. User drags/resizes; model updates.
5. "Save signed PDF" → `exporter` writes a new PDF; original bytes never mutated.

## UI

- Top toolbar: `Open PDF` · `Sign` (draw/replace signature) · `+ Signature` · `+ Date` · `+ Text` · date-format toggle · `Save signed PDF`.
- Pages stacked vertically, centred, grey background.
- Overlay: selected state shows a thin blue border and a bottom-right resize handle. Text/date overlays are `contenteditable`; font size scales with box height.
- Empty state: large drop zone "Drop a PDF here".

## Error handling

- Password-protected PDF → toast: "Couldn't open this PDF (it's password-protected)." Unparsable PDF → "Couldn't open this PDF (encrypted or corrupted)." Non-PDF file → "That is not a PDF." All three are decided before anything is cleared, so a document already open stays open.
- A PDF that parses but fails to render → "Couldn't render this PDF." and the view falls back to the empty state (there is nothing left to show).
- Opening a PDF while one is still rendering → "Still loading the previous PDF…" (the in-flight load is left alone). Dropping several files at once → "One PDF at a time." and the first is used.
- No saved signature when clicking "+ Signature" → opens the signature pad first.
- Export failure → toast with the error message; no download.
- Large PDFs (>50 pages): pages render sequentially; UI stays responsive via `await` between pages.

## Testing

- `test/geometry.test.js` with `node --test`: rotation 0/90/180/270, scale ≠ 1, Y-flip correctness.
- `samples/`: portrait, landscape, and 90°-rotated PDFs; manual checklist in `README.md` (place, resize, export, verify in Preview).

## Out of scope (YAGNI)

Multiple saved signatures, cryptographic/digital signatures, form-field filling, annotations, cloud sync, native `.app` packaging.
