/**
 * Convert a rect in rendered CSS pixels (origin top-left, Y down, on the ROTATED page image)
 * into unrotated PDF points (origin bottom-left, Y up) for pdf-lib.
 *
 * viewport: { scale, rotation (0|90|180|270), width, height, pdfWidth, pdfHeight }
 */
export function toPdfRect(rect, viewport) {
  const { scale, rotation, pdfWidth, pdfHeight } = viewport;
  // 1. CSS px → points, still in rotated-image space with origin top-left.
  const x = rect.x / scale, y = rect.y / scale, w = rect.w / scale, h = rect.h / scale;
  // Rotated image size in points:
  const rw = (rotation === 90 || rotation === 270) ? pdfHeight : pdfWidth;
  const rh = (rotation === 90 || rotation === 270) ? pdfWidth : pdfHeight;

  // 2. Map the rect's corners from rotated top-left space to unrotated bottom-left space.
  // Work with the rect's four corners so w/h swap falls out naturally.
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => {
    switch (rotation) {
      case 0:   return [px, rh - py];
      case 90:  return [py, px];                 // image-left edge = page-bottom, image-top edge = page-left
      case 180: return [rw - px, py];
      case 270: return [rh - py, rw - px];
      default:  throw new Error(`Unsupported page rotation: ${rotation}`);
    }
  });
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** Fraction of the font size between the box bottom and the text baseline (matches the CSS preview). */
export const BASELINE_RATIO = 0.43;

/** Given a PDF-point rect for a text box, return the font size and baseline for pdf-lib drawText. */
export function textLayout(pdfRect) {
  const fontSize = pdfRect.h * 0.8;
  return { fontSize, x: pdfRect.x, baselineY: pdfRect.y + fontSize * BASELINE_RATIO };
}
