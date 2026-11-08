// Proiezione del plastico: Web Mercator locale, in metri, centrata sul riquadro della mappa.
// Il piano XZ di three.js è la mappa (X verso est, Z verso sud), Y è la quota.
import * as THREE from 'three';

const R = 6378137;
const mercX = (lon) => (lon * Math.PI / 180) * R;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R;
const invLon = (x) => (x / R) * 180 / Math.PI;
const invLat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;

export class Geo {
  constructor(bbox) {
    this.bbox = bbox;
    this.x0 = mercX(bbox.w); this.x1 = mercX(bbox.e);
    this.y0 = mercY(bbox.s); this.y1 = mercY(bbox.n);
    const latC = (bbox.n + bbox.s) / 2;
    this.k = Math.cos(latC * Math.PI / 180); // metri Mercator → metri veri alla latitudine centrale
    this.cx = (this.x0 + this.x1) / 2; this.cy = (this.y0 + this.y1) / 2;
    this.larghezza = (this.x1 - this.x0) * this.k;   // metri
    this.altezza = (this.y1 - this.y0) * this.k;
  }
  /** lon/lat → [x, z] in metri locali (z cresce verso sud) */
  aLocale(lon, lat) { return [(mercX(lon) - this.cx) * this.k, -(mercY(lat) - this.cy) * this.k]; }
  /** [x, z] locali → [lon, lat] */
  aGeo(x, z) { return [invLon(this.cx + x / this.k), invLat(this.cy - z / this.k)]; }
  /** lon/lat → coordinate UV (0..1) sul riquadro, u verso est, v verso sud (origine in alto a sinistra) */
  aUV(lon, lat) { return [(mercX(lon) - this.x0) / (this.x1 - this.x0), (this.y1 - mercY(lat)) / (this.y1 - this.y0)]; }
  dentro(lon, lat) { return lon >= this.bbox.w && lon <= this.bbox.e && lat >= this.bbox.s && lat <= this.bbox.n; }
  vettore(lon, lat, y = 0) { const [x, z] = this.aLocale(lon, lat); return new THREE.Vector3(x, y, z); }
}

/** Distanza (m) tra due punti lon/lat (haversine) */
export function distanzaM(a, b) {
  const dLat = (b[1] - a[1]) * Math.PI / 180, dLon = (b[0] - a[0]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
