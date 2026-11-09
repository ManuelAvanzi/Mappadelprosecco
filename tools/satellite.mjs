// Mappa satellitare libera per il plastico: mosaico Sentinel-2 cloudless 2016 di EOX (licenza CC BY 4.0, uso anche commerciale
// con attribuzione: "Sentinel-2 cloudless by EOX IT Services GmbH, contains modified Copernicus Sentinel data 2016").
// Scarica il riquadro del plastico via WMS in Web Mercator (EPSG:3857, stesso sistema delle texture) a tasselli, li cuce
// e scrive public/mappe/satellite.jpg alla stessa dimensione della mappa dei colori (config.colori) e aggiorna config.mappe.
//
// Uso: node tools/satellite.mjs [--px=4096] [--anno=2016]   (gli anni dal 2017 in poi sono CC BY-NC-SA: solo uso non commerciale)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mercX, mercY } from './geometria.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const arg = (k, d) => { const a = ARGS.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const log = (...a) => console.log('[satellite]', ...a);
const cfgFile = path.join(ROOT, 'data/config.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const bbox = cfg.bbox;
const W = +arg('px', cfg.colori?.larghezza || 4096);
const H = Math.round((W * (mercY(bbox.n) - mercY(bbox.s))) / (mercX(bbox.e) - mercX(bbox.w)));
const anno = arg('anno', '2016');
const layer = anno === '2016' ? 's2cloudless_3857' : `s2cloudless-${anno}_3857`;
const T = 1024; // lato dei tasselli richiesti al WMS
const nx = Math.ceil(W / T), ny = Math.ceil(H / T);
log(`${W}×${H} px, ${nx}×${ny} tasselli, strato ${layer}`);

const x0 = mercX(bbox.w), x1 = mercX(bbox.e), y0 = mercY(bbox.s), y1 = mercY(bbox.n);
const tasselli = [];
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const px0 = i * T, py0 = j * T, px1 = Math.min(W, px0 + T), py1 = Math.min(H, py0 + T);
  const bx0 = x0 + ((x1 - x0) * px0) / W, bx1 = x0 + ((x1 - x0) * px1) / W;
  const by1 = y1 - ((y1 - y0) * py0) / H, by0 = y1 - ((y1 - y0) * py1) / H; // y cresce verso nord
  const url = `https://tiles.maps.eox.at/wms?service=WMS&version=1.1.1&request=GetMap&layers=${layer}&styles=&srs=EPSG:3857&bbox=${bx0},${by0},${bx1},${by1}&width=${px1 - px0}&height=${py1 - py0}&format=image/jpeg`;
  let buf, err;
  for (let tentativo = 1; tentativo <= 3 && !buf; tentativo++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'mappa-turistica-prosecco/0.1 (manuel.92.avanzi@gmail.com)' } });
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) throw new Error('HTTP ' + r.status + ' ' + r.headers.get('content-type'));
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 2000 * tentativo)); }
  }
  if (!buf) throw new Error(`tassello ${i},${j}: ${err?.message}`);
  tasselli.push({ input: buf, left: px0, top: py0 });
  log(`  tassello ${i},${j} ok (${(buf.length / 1024).toFixed(0)} kB)`);
}
const out = path.join(ROOT, 'public/mappe/satellite.jpg');
await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(tasselli).jpeg({ quality: 86 }).toFile(out);
log(`scritto ${path.relative(ROOT, out)} ${W}×${H}`);

// aggiorna l'elenco delle mappe: la satellitare punta al mosaico libero, con la sua attribuzione
const attrib = `Sentinel-2 cloudless ${anno} © EOX IT Services GmbH, dati Copernicus Sentinel modificati (CC BY${anno === '2016' ? '' : '-NC-SA'} 4.0)`;
cfg.mappe = (cfg.mappe || []).filter((m) => m.id !== 'satellite');
cfg.mappe.push({ id: 'satellite', nome: `Satellite (Sentinel-2, ${anno})`, file: 'mappe/satellite.jpg', attribuzione: attrib, fonte: 'https://s2maps.eu' });
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
log('config.mappe aggiornato:', cfg.mappe.map((m) => m.id).join(', '));
