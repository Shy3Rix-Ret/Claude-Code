/**
 * Uniformes Raster für Nachbarschaftsabfragen.
 *
 * Die Arena ist begrenzt, also reicht ein festes Raster statt einer Hash-Map:
 * Zelle = (floor(x / size) + offset, floor(y / size) + offset). Jedes Objekt
 * landet anhand seines Mittelpunkts in genau einer Zelle; Abfragen erweitern
 * den Suchradius um `margin`, damit kleine Objekte am Zellrand nicht fehlen.
 *
 * Wird jeden Tick komplett neu aufgebaut — bei mehreren tausend Einträgen
 * günstiger als jedes bewegte Objekt einzeln umzusortieren. Gespeichert wird
 * wie bei einem Counting Sort: alle Einträge in einem Array, nach Zelle
 * sortiert, plus ein Startindex pro Zelle. Keine tausend kleinen Arrays, die
 * der Garbage Collector und der Cache hassen.
 */
export class SpatialHash {
  constructor(cellSize, extent, margin = 16) {
    this.size = cellSize;
    this.inv = 1 / cellSize;
    this.half = Math.ceil(extent / cellSize) + 1;
    this.cols = this.half * 2;
    this.margin = margin;
    const cells = this.cols * this.cols;
    this.start = new Int32Array(cells + 1);   // Einträge der Zelle c: sorted[start[c] … start[c + 1])
    this.fill = new Int32Array(cells);
    this.cellOf = new Int32Array(1024);
    this.items = [];
    this.sorted = [];
    this.n = 0;
    this.dirty = false;
  }

  clear() {
    this.n = 0;
    this.dirty = true;
  }

  _col(v) {
    const c = Math.floor(v * this.inv) + this.half;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  insert(e) {
    if (this.n === this.cellOf.length) {
      const grown = new Int32Array(this.n * 2);
      grown.set(this.cellOf);
      this.cellOf = grown;
    }
    this.cellOf[this.n] = this._col(e.y) * this.cols + this._col(e.x);
    this.items[this.n++] = e;
    this.dirty = true;
  }

  /** Sortiert die Einträge nach Zelle — passiert automatisch vor der ersten Abfrage. */
  build() {
    const { start, fill, cellOf, items, sorted, n } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) start[cellOf[i] + 1]++;
    for (let c = 1; c < start.length; c++) start[c] += start[c - 1];
    fill.set(start.subarray(0, fill.length));
    sorted.length = n;
    for (let i = 0; i < n; i++) sorted[fill[cellOf[i]]++] = items[i];
    // alte Verweise loslassen, damit freigegebene Trümmer nicht im Raster hängen
    for (let i = n; i < items.length; i++) items[i] = undefined;
    this.dirty = false;
  }

  /**
   * Sammelt alle Kandidaten in Zellen, die den Kreis (x, y, r) berühren.
   * Die genaue Distanzprüfung macht der Aufrufer — der braucht sie ohnehin.
   * `out` wird wiederverwendet, um Garbage zu vermeiden.
   */
  query(x, y, r, out) {
    if (this.dirty) this.build();
    out.length = 0;
    const rr = r + this.margin;
    const x0 = this._col(x - rr), x1 = this._col(x + rr);
    const y0 = this._col(y - rr), y1 = this._col(y + rr);
    const { start, sorted, cols } = this;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * cols;
      const a = start[row + x0], b = start[row + x1 + 1];
      for (let i = a; i < b; i++) out.push(sorted[i]);
    }
    return out;
  }
}
