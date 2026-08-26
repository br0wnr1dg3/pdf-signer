# PDF Signer

Sign PDFs locally on your Mac. No accounts, no uploads, no Adobe.

## Run
Double-click `open.command` (or `npm start` then visit http://localhost:8765).

## Use
1. Open / drop a PDF.
2. **Sign** — draw once (or upload a PNG). It's saved in your browser for next time.
3. **+ Signature / + Date / + Text** — drag to move, drag the blue corner to resize, double-click text to edit, `Delete` to remove.
4. **Save signed PDF** — downloads `<name>-signed.pdf`. The original is untouched.

## Tests
`npm test`

## Manual test checklist
Run `npm run samples` first.

| # | Steps | Expected |
|---|-------|----------|
| 1 | Open `samples/portrait.pdf` | Two pages render, 800px wide |
| 2 | Sign → draw → Save | Toast "Signature saved."; survives reload |
| 3 | Scroll to page 2, + Signature | Appears centred on page 2, selected |
| 4 | Drag to a corner; drag past edge | Stays inside the page |
| 5 | Resize via blue handle | Aspect ratio preserved |
| 6 | + Date, toggle format, + Date again | Two dates, different formats |
| 7 | + Text, double-click, type "Chris", Enter | Text updated; Backspace while editing does not delete box |
| 8 | Select overlay, press Delete | Removed |
| 9 | Save signed PDF, open in Preview | Items at placed positions/sizes; original untouched |
| 10 | Repeat 3–9 with `samples/landscape.pdf` | Same |
| 11 | Repeat 3–9 with `samples/rotated90.pdf` | Items upright and correctly placed |
| 12 | Open a password-protected PDF | Toast: password-protected message |
| 13 | Open a 100-page PDF | Renders progressively; scrolling stays usable |
| 14 | With a PDF open, drop a corrupt `.pdf` | Toast; the open document and its overlays remain |
