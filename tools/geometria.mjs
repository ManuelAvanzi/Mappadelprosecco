// Funzioni condivise dai tool: proiezione Web Mercator, conversione delle risposte Overpass in poligoni/linee,
// rasterizzatore minimo (riempimento pari-dispari per scanline, linee come quadrilateri).

export const R = 6378137;
export const mercX = (lon) => (lon * Math.PI) / 180 * R;
export const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
export const invMercLon = (x) => (x / R) * 180 / Math.PI;
export const invMercLat = (y) => ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI;
export const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** Converte la risposta Overpass in anelli (poligoni con buchi) e linee, in coordinate [lon, lat]. */
export function osmGeometrie(j) {
  const nodi = new Map(), vie = new Map();
  for (const e of j.elements) { if (e.type === 'node') nodi.set(e.id, [e.lon, e.lat]); else if (e.type === 'way') vie.set(e.id, e); }
  const coords = (w) => (w.nodes || []).map((n) => nodi.get(n)).filter(Boolean);
  const poligoni = [], linee = [];
  const usate = new Set();
  const uguale = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  for (const e of j.elements) {
    if (e.type !== 'relation' || !e.tags) continue;
    const anelli = [];
    for (const ruolo of ['outer', 'inner']) {
      const pezzi = e.members.filter((m) => m.type === 'way' && (m.role || 'outer') === ruolo && vie.has(m.ref)).map((m) => { usate.add(m.ref); return coords(vie.get(m.ref)); }).filter((c) => c.length > 1);
      while (pezzi.length) {
        let anello = pezzi.shift();
        let guard = 0;
        while (guard++ < 5000) {
          const a = anello[0], z = anello[anello.length - 1];
          if (uguale(a, z)) break;
          const k = pezzi.findIndex((p) => uguale(p[0], z) || uguale(p[p.length - 1], z));
          if (k < 0) break;
          const p = pezzi.splice(k, 1)[0];
          anello = uguale(p[0], z) ? anello.concat(p.slice(1)) : anello.concat(p.reverse().slice(1));
        }
        if (anello.length > 3) anelli.push(anello);
      }
    }
    if (anelli.length) poligoni.push({ tags: e.tags, anelli });
  }
  for (const w of vie.values()) {
    if (!w.tags || usate.has(w.id)) continue;
    const c = coords(w);
    if (c.length < 2) continue;
    const chiuso = c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
    if (chiuso && !w.tags.highway && !w.tags.railway && !w.tags.waterway) poligoni.push({ tags: w.tags, anelli: [c] });
    else linee.push({ tags: w.tags, punti: c });
  }
  return { poligoni, linee };
}

/** Tela RGB a 8 bit con riempimento di poligoni (pari-dispari) e linee spesse. */
export class Tela {
  constructor(w, h, canali = 3) { this.w = w; this.h = h; this.c = canali; this.px = new Uint8ClampedArray(w * h * canali); }
  riempi(rgb) { for (let i = 0; i < this.w * this.h; i++) for (let k = 0; k < this.c; k++) this.px[i * this.c + k] = rgb[k] ?? rgb[0]; }
  poligono(anelli, rgb) {
    let ymin = Infinity, ymax = -Infinity;
    for (const a of anelli) for (const p of a) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
    const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(this.h - 1, Math.ceil(ymax));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5; xs.length = 0;
      for (const a of anelli) for (let i = 0, n = a.length; i < n; i++) {
        const p = a[i], q = a[(i + 1) % n];
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) xs.push(p[0] + ((yc - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      if (xs.length < 2) continue;
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(this.w - 1, Math.round(xs[k + 1]) - 1);
        for (let x = xa; x <= xb; x++) { const o = (y * this.w + x) * this.c; for (let m = 0; m < this.c; m++) this.px[o + m] = rgb[m] ?? rgb[0]; }
      }
    }
  }
  linea(punti, spessore, rgb) {
    const r = spessore / 2;
    for (let i = 0; i + 1 < punti.length; i++) {
      const [x0, y0] = punti[i], [x1, y1] = punti[i + 1];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
      const nx = (-dy / L) * r, ny = (dx / L) * r;
      this.poligono([[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]], rgb);
      if (spessore > 2) {
        const c = []; for (let k = 0; k < 8; k++) c.push([x1 + r * Math.cos((k * Math.PI) / 4), y1 + r * Math.sin((k * Math.PI) / 4)]);
        this.poligono([c], rgb);
      }
    }
  }
}
