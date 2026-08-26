/** Fraction of the font size between the box bottom and the text baseline (matches the CSS preview). */
export const BASELINE_RATIO = 0.43;

/** Font size as a fraction of the text box's thickness, so Helvetica's ascender fits inside. */
export const FONT_SIZE_RATIO = 0.8;

/** Accept any multiple of 90 (including negatives) and reduce it to 0 | 90 | 180 | 270. */
function normalizeRotation(rotation) {
  const r = ((rotation % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(r)) throw new Error(`Unsupported page rotation: ${r}`);
  return r;
}

/**
 * Convert a rect in rendered CSS pixels (origin top-left, Y down, on the ROTATED page image)
 * into unrotated PDF points (origin bottom-left, Y up) for pdf-lib.
 *
 * viewport: { scale, rotation (0|90|180|270), pdfWidth, pdfHeight } — the rendered
 * width/height are implied by scale and rotation, so they are not read here.
 */
export function toPdfRect(rect, viewport) {
  const { scale, pdfWidth, pdfHeight } = viewport;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid scale: ${scale}`);
  const rotation = normalizeRotation(viewport.rotation);

  // 1. CSS px → points, still in rotated-image space with origin top-left.
  const x = rect.x / scale, y = rect.y / scale, w = rect.w / scale, h = rect.h / scale;
  // Rotated image size in points:
  const rw = (rotation === 90 || rotation === 270) ? pdfHeight : pdfWidth;
  const rh = (rotation === 90 || rotation === 270) ? pdfWidth : pdfHeight;

  // 2. Map the rect's corners from rotated top-left space to unrotated bottom-left space.
  // Work with the rect's four corners so w/h swap falls out naturally.
  const mapPoint = {
    0:   ([px, py]) => [px, rh - py],
    90:  ([px, py]) => [py, px],           // image-left edge = page-bottom, image-top edge = page-left
    180: ([px, py]) => [rw - px, py],      // image-left edge = page-right,  image-top edge = page-bottom
    270: ([px, py]) => [rh - py, rw - px], // image-left edge = page-top,    image-top edge = page-right
  }[rotation];

  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(mapPoint);
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/**
 * Args for pdf-lib's `page.drawImage` that paint the image into `pdfRect` (unrotated page
 * points) turned `rotation`° so it reads upright once the viewer applies the page's /Rotate.
 *
 * pdf-lib rotates counter-clockwise about the (x, y) anchor, mapping the image's width-axis
 * to `rotation` and its height-axis to `rotation + 90`; the anchor corner below is the one
 * that makes the swept rect exactly `pdfRect`. `rotate` is degrees — wrap it in `degrees()`.
 */
export function imageLayout(pdfRect, rotation = 0) {
  const rot = normalizeRotation(rotation);
  const r = pdfRect;
  return {
    ...{
      0:   { x: r.x,       y: r.y,       width: r.w, height: r.h },
      90:  { x: r.x + r.w, y: r.y,       width: r.h, height: r.w },
      180: { x: r.x + r.w, y: r.y + r.h, width: r.w, height: r.h },
      270: { x: r.x,       y: r.y + r.h, width: r.h, height: r.w },
    }[rot],
    rotate: rot,
  };
}

/**
 * Args for pdf-lib's `page.drawText` that fit a single line into `pdfRect` (unrotated page
 * points) turned `rotation`° so it reads upright once the viewer applies the page's /Rotate.
 *
 * The anchor is the baseline start. Text runs along `rotation` and ascends toward
 * `rotation + 90`, so the box thickness that sets the font size is the rect's height at
 * 0/180 and its width at 90/270, and the baseline sits `size * BASELINE_RATIO` in from
 * whichever edge is "below" the text. `rotate` is degrees — wrap it in `degrees()`.
 */
export function textLayout(pdfRect, rotation = 0) {
  const rot = normalizeRotation(rotation);
  const r = pdfRect;
  const size = ((rot === 90 || rot === 270) ? r.w : r.h) * FONT_SIZE_RATIO;
  const pad = size * BASELINE_RATIO;
  return {
    ...{
      0:   { x: r.x,             y: r.y + pad },
      90:  { x: r.x + r.w - pad, y: r.y },
      180: { x: r.x + r.w,       y: r.y + r.h - pad },
      270: { x: r.x + pad,       y: r.y + r.h },
    }[rot],
    size,
    rotate: rot,
  };
}
