// Costruisce i dati del plastico a partire da fonti aperte (tutte senza chiave):
//   - Nominatim (OpenStreetMap) per affinare le coordinate dei luoghi        -> data/luoghi.geojson, data/poi.json (se manca)
//   - OSRM (rete stradale OpenStreetMap) per i tracciati degli itinerari      -> data/itinerari.json (se manca)
//   - Tile altimetrici "terrarium" (Mapzen/AWS Open Data, SRTM/EU-DEM)        -> data/altimetria.png (RGB terrarium, 1/256 m)
//   - Overpass (OpenStreetMap) per vigneti, boschi, centri abitati, acque,     -> data/colori.jpg (mappa dei colori in vettoriale rasterizzato)
//     strade e ferrovie, resi in colori semplificati                          -> data/vettori.json (riassunto)
//   - Calibrazione delle tre mappe fornite (screenshot Google in Web Mercator) -> data/config.json (bbox del plastico)
//
// Uso:  node tools/build-data.mjs [--no-cache] [--forza] [--solo=terreno|colori|luoghi|itinerari]
//   --forza riscrive anche poi.json / itinerari.json (ATTENZIONE: perde le modifiche fatte dal backend)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LUOGHI, LIVELLI, ITINERARI, BBOX_GEOCODE } from './luoghi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(DATA, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const ARGS = process.argv.slice(2);
const NO_CACHE = ARGS.includes('--no-cache');
const FORZA = ARGS.includes('--forza');
const SOLO = (ARGS.find((a) => a.startsWith('--solo=')) || '').slice(7);
const UA = 'mappa-turistica-prosecco/0.1 (uso didattico; manuel.92.avanzi@gmail.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[dati]', ...a);
const leggiJSON = (f, def) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def);
const scriviJSON = (f, v, compatto = false) => fs.writeFileSync(f, compatto ? JSON.stringify(v) : JSON.stringify(v, null, 2) + '\n');

async function cached(key, fn) {
  const f = path.join(CACHE, key + '.json');
  if (!NO_CACHE && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

async function getJSON(url, opts = {}, tentativi = 3) {
  for (let i = 1; i <= tentativi; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tentativi) throw e;
      log(`  tentativo ${i} fallito (${e.message}), riprovo…`);
      await sleep(2500 * i);
    }
  }
}

// ── Geometria: Web Mercator ─────────────────────────────────────────────
const R = 6378137;
const mercX = (lon) => (lon * Math.PI) / 180 * R;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
const invMercLat = (y) => ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI;
const distKm = (a, b) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
};

// ── 0. Calibrazione delle mappe fornite ────────────────────────────────
// Le tre mappe "GRANDE" sono screenshot Google Maps (12292×7898 px, Web Mercator) con lo stesso inquadramento.
// Ancore: posizione in pixel delle etichette di tre città ↔ coordinate del nodo OpenStreetMap.
// Vincolo: proiezione conforme, quindi stessa scala in X e in Y-Mercator. Modificare le ancore per affinare.
const MAPPA_PX = { w: 12292, h: 7898 };
const ANCORE = [
  { x: 2061, y: 4041, lon: 11.99551, lat: 45.90141 }, // Valdobbiadene
  { x: 9281, y: 4459, lon: 12.29776, lat: 45.88622 }, // Conegliano
  { x: 9262, y: 1109, lon: 12.29585, lat: 45.98982 }, // Vittorio Veneto
];
function calibra() {
  let mx = 0, ml = 0;
  for (const p of ANCORE) { mx += p.x; ml += p.lon; }
  mx /= ANCORE.length; ml /= ANCORE.length;
  let sxx = 0, sxy = 0;
  for (const p of ANCORE) { sxx += (p.lon - ml) ** 2; sxy += (p.lon - ml) * (p.x - mx); }
  const a = sxy / sxx, b = mx - a * ml;             // x = a·lon + b
  const c = -a * 180 / Math.PI;                       // y = c·Y(lat) + d, Y in radianti
  const Y = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  let d = 0; for (const p of ANCORE) d += p.y - c * Y(p.lat); d /= ANCORE.length;
  const lon = (x) => (x - b) / a;
  const lat = (y) => ((2 * Math.atan(Math.exp((y - d) / c)) - Math.PI / 2) * 180) / Math.PI;
  const errori = ANCORE.map((p) => ({ dx: Math.round(a * p.lon + b - p.x), dy: Math.round(c * Y(p.lat) + d - p.y) }));
  return { bbox: { w: +lon(0).toFixed(6), e: +lon(MAPPA_PX.w).toFixed(6), n: +lat(0).toFixed(6), s: +lat(MAPPA_PX.h).toFixed(6) }, errori };
}

// ── 1. Luoghi: geocodifica con Nominatim ───────────────────────────────
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').trim();
function livelloDi(nome) {
  const n = norm(nome);
  for (const lv of [1, 2, 3]) if (LIVELLI[lv].some((x) => norm(x) === n)) return lv;
  return 3;
}
async function geocodifica() {
  log('Geocodifica luoghi (Nominatim)…');
  const feats = [];
  for (const L of LUOGHI) {
    let lat = L.lat, lon = L.lon, fonte = 'stima';
    try {
      const res = await cached('nominatim_' + L.id, async () => {
        const u = new URL('https://nominatim.openstreetmap.org/search');
        u.searchParams.set('q', L.q || L.nome);
        u.searchParams.set('format', 'jsonv2');
        u.searchParams.set('limit', '5');
        u.searchParams.set('countrycodes', 'it');
        u.searchParams.set('viewbox', `${BBOX_GEOCODE.w},${BBOX_GEOCODE.n},${BBOX_GEOCODE.e},${BBOX_GEOCODE.s}`);
        u.searchParams.set('bounded', '1');
        const j = await getJSON(u.toString());
        await sleep(1100); // limite Nominatim: 1 richiesta al secondo
        return j;
      });
      const ok = (res || []).map((r) => ({ lat: +r.lat, lon: +r.lon, d: distKm([L.lon, L.lat], [+r.lon, +r.lat]) }))
        .filter((r) => r.d < 6).sort((p, q) => p.d - q.d)[0];
      if (ok) { lat = ok.lat; lon = ok.lon; fonte = 'osm'; }
      else log(`  ${L.id}: nessun risultato vicino, tengo la stima`);
    } catch (e) { log(`  ${L.id}: Nominatim non disponibile (${e.message}), tengo la stima`); }
    feats.push({ type: 'Feature', properties: { id: L.id, nome: L.nome, tipo: L.tipo, cat: L.cat || null, livello: L.tipo === 'monumento' ? 2 : livelloDi(L.nome), fonte },
      geometry: { type: 'Point', coordinates: [+lon.toFixed(5), +lat.toFixed(5)] } });
  }
  scriviJSON(path.join(DATA, 'luoghi.geojson'), { type: 'FeatureCollection', features: feats }, true);
  log(`  ${feats.length} luoghi (${feats.filter((f) => f.properties.fonte === 'osm').length} da OSM)`);
  return feats;
}

const CATEGORIE = { castello: 'Castelli', abbazia: 'Abbazie e chiese', chiesa: 'Abbazie e chiese', pieve: 'Abbazie e chiese', campanile: 'Abbazie e chiese',
  loggia: 'Palazzi e ville', villa: 'Palazzi e ville', mulino: 'Luoghi della tradizione', grotta: 'Natura', lago: 'Natura' };

function generaPoi(feats) {
  const f = path.join(DATA, 'poi.json');
  if (fs.existsSync(f) && !FORZA) { log('poi.json esiste già: non lo tocco (usa --forza per rigenerarlo)'); return; }
  const byId = Object.fromEntries(feats.map((x) => [x.properties.id, x]));
  const poi = LUOGHI.map((L, i) => {
    const g = byId[L.id].geometry.coordinates;
    const mon = L.tipo === 'monumento';
    return {
      id: L.id, nome: L.nome, tipo: L.tipo,
      categoria: mon ? CATEGORIE[L.cat] || 'Monumenti' : 'Città e paesi',
      livello: mon ? 2 : livelloDi(L.nome),
      visibile: !L.nascosto,
      lat: g[1], lon: g[0],
      descrizione: L.desc || '',
      media: [],
      modello: mon ? { tipo: L.cat, glb: L.glb ? 'modelli/' + L.glb : null, scala: 1, rotazione: 0 } : null,
      ordine: i,
    };
  });
  scriviJSON(f, poi);
  log(`  poi.json: ${poi.length} punti di interesse (${poi.filter((p) => p.modello).length} con modello 3D)`);
}

// ── 2. Itinerari: tracciato stradale OSRM ──────────────────────────────
async function itinerari(feats) {
  const f = path.join(DATA, 'itinerari.json');
  if (fs.existsSync(f) && !FORZA) { log('itinerari.json esiste già: non lo tocco (usa --forza)'); return; }
  log('Itinerari su rete stradale (OSRM)…');
  const byId = Object.fromEntries(feats.map((x) => [x.properties.id, x.geometry.coordinates]));
  const out = [];
  for (const it of ITINERARI) {
    const pts = it.tappe.map((id) => { if (!byId[id]) throw new Error('tappa sconosciuta: ' + id); return byId[id]; });
    let geometria, km = null, fonte = 'spezzata';
    try {
      const j = await cached('osrm_' + it.id, async () => {
        const coords = pts.map((c) => c.join(',')).join(';');
        const r = await getJSON(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`);
        await sleep(600);
        return r;
      });
      if (j.code !== 'Ok') throw new Error(j.code);
      geometria = j.routes[0].geometry.coordinates.map((c) => [+c[0].toFixed(5), +c[1].toFixed(5)]);
      km = +(j.routes[0].distance / 1000).toFixed(1); fonte = 'osrm';
      log(`  ${it.id}: ${km} km, ${geometria.length} punti`);
    } catch (e) {
      log(`  ${it.id}: OSRM non disponibile (${e.message}), uso la spezzata tra le tappe`);
      geometria = pts;
    }
    out.push({ id: it.id, nome: it.nome, sottotitolo: it.sottotitolo || '', descrizione: it.desc || '', colore: it.colore || '#c62828',
      visibile: true, tappe: it.tappe, geometria, km, fonte, audio: [] });
  }
  scriviJSON(f, out, true);
}

// ── 3. Terreno: tile altimetrici terrarium ─────────────────────────────
// Ogni tile 256×256 codifica la quota in metri come R·256 + G + B/256 − 32768. Zoom 12 ≈ 27 m/px a questa latitudine.
const Z = 12;
const tilePx = (lon, lat) => {
  const n = 2 ** Z * 256;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
};
async function scaricaTile(tx, ty) {
  const f = path.join(CACHE, `terrarium_${Z}_${tx}_${ty}.png`);
  if (!fs.existsSync(f)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        break;
      } catch (e) { if (i === 3) throw e; await sleep(1500 * i); }
    }
  }
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) h[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
  if (info.width !== 256) throw new Error('tile inattesa ' + info.width);
  return h;
}
async function terreno(bbox, cfg) {
  log('Terreno: tile altimetrici terrarium…');
  const [x0, y0] = tilePx(bbox.w, bbox.n), [x1, y1] = tilePx(bbox.e, bbox.s);
  const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
  const tiles = {};
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) tiles[`${tx}_${ty}`] = await scaricaTile(tx, ty);
  log(`  ${Object.keys(tiles).length} tile (x ${tx0}-${tx1}, y ${ty0}-${ty1})`);
  const quota = (px, py) => { // bilineare
    const fx = Math.floor(px), fy = Math.floor(py), ax = px - fx, ay = py - fy;
    const q = (ix, iy) => { const t = tiles[`${Math.floor(ix / 256)}_${Math.floor(iy / 256)}`]; return t ? t[(iy % 256) * 256 + (ix % 256)] : 0; };
    return q(fx, fy) * (1 - ax) * (1 - ay) + q(fx + 1, fy) * ax * (1 - ay) + q(fx, fy + 1) * (1 - ax) * ay + q(fx + 1, fy + 1) * ax * ay;
  };
  const W = 1536, H = Math.round((W * (y1 - y0)) / (x1 - x0));
  const buf = Buffer.alloc(W * H * 3);
  let hmin = Infinity, hmax = -Infinity;
  const quote = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = x0 + ((i + 0.5) / W) * (x1 - x0), py = y0 + ((j + 0.5) / H) * (y1 - y0);
    let h = quota(px, py); if (!isFinite(h) || h < -100) h = 0;
    quote[j * W + i] = h; hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
    const v = Math.round((h + 32768) * 256);
    buf[(j * W + i) * 3] = (v >> 16) & 255; buf[(j * W + i) * 3 + 1] = (v >> 8) & 255; buf[(j * W + i) * 3 + 2] = v & 255;
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(DATA, 'altimetria.png'));
  cfg.terreno = { ...(cfg.terreno || {}), file: 'altimetria.png', larghezza: W, altezza: H, quotaMin: Math.round(hmin), quotaMax: Math.round(hmax), zoomTile: Z,
    fonte: 'Mapzen/AWS Terrain Tiles (terrarium), dati SRTM/EU-DEM' };
  log(`  altimetria.png ${W}×${H}, quote ${Math.round(hmin)}–${Math.round(hmax)} m`);
  return { W, H, quote };
}

// ── 4. Colori: vettori OpenStreetMap rasterizzati ──────────────────────
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];
async function overpass(key, query) {
  return cached(key, async () => {
    let err;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!j.elements) throw new Error('risposta senza elementi');
        return j;
      } catch (e) { err = e; log(`  ${url}: ${e.message}`); await sleep(3000); }
    }
    throw err;
  });
}

// Converte la risposta Overpass in anelli (poligoni con buchi) e linee, in coordinate [lon, lat].
function osmGeometrie(j) {
  const nodi = new Map(), vie = new Map();
  for (const e of j.elements) { if (e.type === 'node') nodi.set(e.id, [e.lon, e.lat]); else if (e.type === 'way') vie.set(e.id, e); }
  const coords = (w) => (w.nodes || []).map((n) => nodi.get(n)).filter(Boolean);
  const poligoni = [], linee = [];
  const usate = new Set();
  for (const e of j.elements) {
    if (e.type !== 'relation' || !e.tags) continue;
    const anelli = [];
    for (const ruolo of ['outer', 'inner']) {
      const pezzi = e.members.filter((m) => m.type === 'way' && (m.role || 'outer') === ruolo && vie.has(m.ref)).map((m) => { usate.add(m.ref); return coords(vie.get(m.ref)); }).filter((c) => c.length > 1);
      // concatena i pezzi in anelli chiusi
      while (pezzi.length) {
        let anello = pezzi.shift();
        let chiuso = false, guard = 0;
        while (!chiuso && guard++ < 5000) {
          const a = anello[0], z = anello[anello.length - 1];
          if (Math.abs(a[0] - z[0]) < 1e-9 && Math.abs(a[1] - z[1]) < 1e-9) { chiuso = true; break; }
          const k = pezzi.findIndex((p) => (Math.abs(p[0][0] - z[0]) < 1e-9 && Math.abs(p[0][1] - z[1]) < 1e-9) || (Math.abs(p[p.length - 1][0] - z[0]) < 1e-9 && Math.abs(p[p.length - 1][1] - z[1]) < 1e-9));
          if (k < 0) break;
          const p = pezzi.splice(k, 1)[0];
          if (Math.abs(p[0][0] - z[0]) < 1e-9 && Math.abs(p[0][1] - z[1]) < 1e-9) anello = anello.concat(p.slice(1)); else anello = anello.concat(p.reverse().slice(1));
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

// Rasterizzatore minimo: riempimento pari-dispari per scanline e linee come quadrilateri.
class Tela {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 3); }
  riempi(rgb) { for (let i = 0; i < this.w * this.h; i++) { this.px[i * 3] = rgb[0]; this.px[i * 3 + 1] = rgb[1]; this.px[i * 3 + 2] = rgb[2]; } }
  poligono(anelli, rgb) { // anelli in pixel
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
        for (let x = xa; x <= xb; x++) { const o = (y * this.w + x) * 3; this.px[o] = rgb[0]; this.px[o + 1] = rgb[1]; this.px[o + 2] = rgb[2]; }
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
      if (spessore > 2) { // giunto tondo approssimato
        const c = []; for (let k = 0; k < 8; k++) c.push([x1 + r * Math.cos((k * Math.PI) / 4), y1 + r * Math.sin((k * Math.PI) / 4)]);
        this.poligono([c], rgb);
      }
    }
  }
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// Tavolozza "mappa di carta": colori semplificati derivati dalla mappa satellitare.
export const COLORI = {
  pianura: '#ece7d3', collina: '#e3e4c6', montagna: '#d6dac2', roccia: '#d9d6cf',
  vigneto: '#c3d57f', bosco: '#86a86a', frutteto: '#b9cf8a', prato: '#dfe6b8',
  abitato: '#dad3cb', industriale: '#cfc9c3', acqua: '#8fc2dd', fiume: '#8fc2dd', torrente: '#a5cde0',
  autostrada: '#f4b26b', strada: '#ffffff', stradaBordo: '#c9c1b2', ferrovia: '#8a8a8a',
};

async function colori(bbox, terr, cfg) {
  log('Colori: vettori OpenStreetMap (Overpass)…');
  const bb = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const temi = {
    vigneti: `[out:json][timeout:180];(way["landuse"="vineyard"](${bb});relation["landuse"="vineyard"](${bb}););out body;>;out skel qt;`,
    boschi: `[out:json][timeout:240];(way["natural"="wood"](${bb});relation["natural"="wood"](${bb});way["landuse"="forest"](${bb});relation["landuse"="forest"](${bb});way["landuse"="orchard"](${bb});way["natural"="scrub"](${bb}););out body;>;out skel qt;`,
    abitati: `[out:json][timeout:180];(way["landuse"~"^(residential|industrial|commercial|retail)$"](${bb});relation["landuse"~"^(residential|industrial|commercial|retail)$"](${bb}););out body;>;out skel qt;`,
    acque: `[out:json][timeout:180];(way["natural"="water"](${bb});relation["natural"="water"](${bb});way["waterway"~"^(river|stream|canal)$"](${bb});way["landuse"="reservoir"](${bb});relation["waterway"="riverbank"](${bb}););out body;>;out skel qt;`,
    strade: `[out:json][timeout:180];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});way["railway"="rail"](${bb}););out body;>;out skel qt;`,
  };
  const W = 3072, H = Math.round((W * terr.H) / terr.W);
  const [mx0, my0] = [mercX(bbox.w), mercY(bbox.n)], [mx1, my1] = [mercX(bbox.e), mercY(bbox.s)];
  const toPx = (c) => [((mercX(c[0]) - mx0) / (mx1 - mx0)) * W, ((mercY(c[1]) - my0) / (my1 - my0)) * H];
  const tela = new Tela(W, H);
  // base: tinta per fascia altimetrica
  const cp = hex(COLORI.pianura), cc = hex(COLORI.collina), cm = hex(COLORI.montagna), cr = hex(COLORI.roccia);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = terr.quote[Math.floor((j * terr.H) / H) * terr.W + Math.floor((i * terr.W) / W)];
    const c = h < 180 ? cp : h < 500 ? cc : h < 1100 ? cm : cr;
    const o = (j * W + i) * 3; tela.px[o] = c[0]; tela.px[o + 1] = c[1]; tela.px[o + 2] = c[2];
  }
  const riassunto = {};
  const ordine = ['boschi', 'vigneti', 'abitati', 'acque', 'strade'];
  for (const tema of ordine) {
    let j;
    try { j = await overpass('overpass_' + tema, temi[tema]); }
    catch (e) { log(`  ${tema}: Overpass non disponibile (${e.message}), salto`); continue; }
    const { poligoni, linee } = osmGeometrie(j);
    riassunto[tema] = { poligoni: poligoni.length, linee: linee.length };
    log(`  ${tema}: ${poligoni.length} poligoni, ${linee.length} linee`);
    for (const p of poligoni) {
      const t = p.tags;
      let col = null;
      if (t.landuse === 'vineyard') col = COLORI.vigneto;
      else if (t.natural === 'wood' || t.landuse === 'forest') col = COLORI.bosco;
      else if (t.landuse === 'orchard') col = COLORI.frutteto;
      else if (t.natural === 'scrub') col = COLORI.prato;
      else if (t.landuse === 'residential') col = COLORI.abitato;
      else if (['industrial', 'commercial', 'retail'].includes(t.landuse)) col = COLORI.industriale;
      else if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') col = COLORI.acqua;
      if (!col) continue;
      tela.poligono(p.anelli.map((a) => a.map(toPx)), hex(col));
    }
    for (const l of linee) {
      const t = l.tags, pts = l.punti.map(toPx);
      if (t.waterway === 'river') tela.linea(pts, 5, hex(COLORI.fiume));
      else if (t.waterway === 'stream' || t.waterway === 'canal') tela.linea(pts, 2, hex(COLORI.torrente));
      else if (t.railway === 'rail') tela.linea(pts, 2.5, hex(COLORI.ferrovia));
      else if (t.highway === 'motorway') { tela.linea(pts, 9, hex(COLORI.stradaBordo)); tela.linea(pts, 6, hex(COLORI.autostrada)); }
      else if (t.highway === 'trunk' || t.highway === 'primary') { tela.linea(pts, 7, hex(COLORI.stradaBordo)); tela.linea(pts, 4.5, hex(COLORI.strada)); }
      else if (t.highway === 'secondary') { tela.linea(pts, 5, hex(COLORI.stradaBordo)); tela.linea(pts, 3, hex(COLORI.strada)); }
      else if (t.highway === 'tertiary') { tela.linea(pts, 3.5, hex(COLORI.stradaBordo)); tela.linea(pts, 2, hex(COLORI.strada)); }
    }
  }
  await sharp(Buffer.from(tela.px.buffer), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(DATA, 'colori.jpg'));
  scriviJSON(path.join(DATA, 'vettori.json'), { generato: new Date().toISOString(), larghezza: W, altezza: H, temi: riassunto, colori: COLORI, fonte: 'OpenStreetMap (ODbL) via Overpass' });
  cfg.colori = { file: 'colori.jpg', larghezza: W, altezza: H };
  log(`  colori.jpg ${W}×${H}`);
}

// ── Main ────────────────────────────────────────────────────────────────
const t0 = Date.now();
const cfgFile = path.join(DATA, 'config.json');
const cfg = leggiJSON(cfgFile, {});
const cal = calibra();
log('Calibrazione mappe:', JSON.stringify(cal.bbox), 'errori px', JSON.stringify(cal.errori));
cfg.titolo = cfg.titolo || 'Mappa turistica del Prosecco';
cfg.bbox = cal.bbox;
cfg.mappePx = MAPPA_PX;
cfg.livelli = cfg.livelli || { 2: 26000, 3: 11000 };      // distanza della camera (m) sotto cui compaiono i livelli 2 e 3
cfg.esagerazione = cfg.esagerazione || 1.7;                // esagerazione verticale del plastico
cfg.modelli = cfg.modelli || { fattoreDistanza: 0.035, scalaMinima: 1 }; // dimensione modelli = max(reale, distanza·fattore)
cfg.mappe = cfg.mappe || [
  { id: 'colori', nome: 'Mappa dei colori (vettoriale)', file: 'data/colori.jpg', predefinita: true },
  { id: 'stradale', nome: 'Mappa stradale', file: 'mappe/stradale.jpg' },
  { id: 'rilievo', nome: 'Mappa del rilievo', file: 'mappe/rilievo.jpg' },
  { id: 'satellite', nome: 'Mappa satellitare', file: 'mappe/satellite.jpg' },
];
scriviJSON(cfgFile, cfg);

const feats = (!SOLO || SOLO === 'luoghi' || SOLO === 'itinerari') ? await geocodifica() : leggiJSON(path.join(DATA, 'luoghi.geojson'), { features: [] }).features;
if (!SOLO || SOLO === 'luoghi') generaPoi(feats);
if (!SOLO || SOLO === 'itinerari') await itinerari(feats);
let terr = null;
if (!SOLO || SOLO === 'terreno' || SOLO === 'colori') terr = await terreno(cfg.bbox, cfg);
if (!SOLO || SOLO === 'colori') await colori(cfg.bbox, terr, cfg);
scriviJSON(cfgFile, cfg);
log(`fatto in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
