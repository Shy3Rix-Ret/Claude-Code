/** Offscreen-Canvas in Pixelgröße — die Grundlage aller prozeduralen Grafik. */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
