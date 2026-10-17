/**
 * Uniformes Raster für Nachbarschaftsabfragen.
 *
 * Die Arena ist begrenzt, also reicht ein festes Array statt einer Hash-Map:
 * Zelle = (floor(x / size) + offset, floor(y / size) + offset). Jedes Objekt
 * landet anhand seines Mittelpunkts in genau einer Zelle; Abfragen erweitern
 * den Suchradius um `margin`, damit kleine Objekte am Zellrand nicht fehlen.
 *
 * Wird jeden Tick komplett neu aufgebaut — bei ~2000 Einträgen günstiger als
 * jedes bewegte Objekt einzeln umzusortieren.
 */
export class SpatialHash {
  constructor(cellSize, extent, margin = 16) {
    this.size = cellSize;
    this.inv = 1 / cellSize;
    this.half = Math.ceil(extent / cellSize) + 1;
    this.cols = this.half * 2;
    this.margin = margin;
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
    this.used = [];
  }

  clear() {
    const { cells, used } = this;
    for (let i = 0; i < used.length; i++) cells[used[i]].length = 0;
    used.length = 0;
  }

  _col(v) {
    const c = Math.floor(v * this.inv) + this.half;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  insert(e) {
    const i = this._col(e.y) * this.cols + this._col(e.x);
    const cell = this.cells[i];
    if (cell.length === 0) this.used.push(i);
    cell.push(e);
  }

  /**
   * Sammelt alle Kandidaten in Zellen, die den Kreis (x, y, r) berühren.
   * Die genaue Distanzprüfung macht der Aufrufer — der braucht sie ohnehin.
   * `out` wird wiederverwendet, um Garbage zu vermeiden.
   */
  query(x, y, r, out) {
    out.length = 0;
    const rr = r + this.margin;
    const x0 = this._col(x - rr), x1 = this._col(x + rr);
    const y0 = this._col(y - rr), y1 = this._col(y + rr);
    const { cells, cols } = this;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * cols;
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cells[row + cx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}
