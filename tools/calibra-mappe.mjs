// Calibra (georeferenzia) le mappe fornite sul plastico con una registrazione automatica:
// confronta una maschera letta dalla mappa stradale fornita (strade grigie e/o specchi d'acqua azzurri) con la stessa
// maschera disegnata dai vettori OpenStreetMap (cache Overpass), cercando scala e spostamento che le sovrappongono meglio
// (proiezione conforme: stessa scala in X e Y-Mercator). Il risultato aggiorna bbox in data/config.json.
//
// Uso:  node tools/calibra-mappe.mjs [--tema=strade|laghi|acqua|tutto] [--applica]
//   tema predefinito "tutto" (strade + laghi: le strade sono il riferimento più preciso, i fiumi differiscono tra le fonti).
//   Senza --applica mostra solo il risultato. Poi rigenerare terreno e colori sul nuovo riquadro:
//   node tools/build-data.mjs --solo=terreno   e   node tools/build-data.mjs --solo=colori
//   Scrive data/cache/calibrazione-controllo-*.jpg: ritagli della mappa con i vettori OSM in rosso dopo la calibrazione.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mercX, mercY, invMercLon, invMercLat, osmGeometrie, Tela } from './geometria.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const log = (...a) => console.log('[calibra]', ...a);
const APPLICA = process.argv.includes('--applica');
const TEMA = (process.argv.find((a) => a.startsWith('--tema=')) || '--tema=tutto').slice(7);

const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'));
const mappaFile = path.join(ROOT, 'public/mappe/stradale.jpg');
if (!fs.existsSync(mappaFile)) { console.error('Manca public/mappe/stradale.jpg: esegui prima npm run materiali'); process.exit(1); }
const cache = (n) => { const f = path.join(DATA, 'cache', `overpass_${n}.json`); if (!fs.existsSync(f)) { console.error(`Manca ${f}: esegui prima npm run dati`); process.exit(1); } return osmGeometrie(JSON.parse(fs.readFileSync(f, 'utf8'))); };
const usaStrade = TEMA === 'strade' || TEMA === 'tutto', usaLaghi = TEMA === 'laghi' || TEMA === 'tutto', usaFiumi = TEMA === 'acqua';
const geoAcque = usaLaghi || usaFiumi ? cache('acque') : null, geoStrade = usaStrade ? cache('strade') : null;

// 1. maschera dalla mappa fornita: azzurro Google per l'acqua, grigio neutro 195–218 per le strade
async function mascheraImmagine(W) {
  const { data, info } = await sharp(mappaFile).resize({ width: W }).raw().toBuffer({ resolveWithObject: true });
  const H = info.height, m = new Uint8Array(W * H); let n = 0;
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const acqua = b > r + 45 && b > g + 5 && r < 200;
    const strada = r >= 195 && r <= 218 && Math.abs(r - g) < 10 && Math.abs(g - b) < 14 && b >= r - 2;
    if (((usaLaghi || usaFiumi) && acqua) || (usaStrade && strada)) { m[i] = 1; n++; }
  }
  return { m, W, H, n };
}
// 2. maschera dai vettori OSM nel riquadro dato (frame di riferimento)
function mascheraOSM(bbox, W, H, spessore = Math.max(1.5, W / 900)) {
  const mx0 = mercX(bbox.w), mx1 = mercX(bbox.e), my0 = mercY(bbox.n), my1 = mercY(bbox.s);
  const toPx = (c) => [((mercX(c[0]) - mx0) / (mx1 - mx0)) * W, ((mercY(c[1]) - my0) / (my1 - my0)) * H];
  const t = new Tela(W, H, 1);
  if (geoAcque) {
    for (const p of geoAcque.poligoni) { const area = p.tags.water === 'river' || p.tags.waterway === 'riverbank'; if (usaFiumi || (usaLaghi && !area)) t.poligono(p.anelli.map((a) => a.map(toPx)), [1]); }
    if (usaFiumi) for (const l of geoAcque.linee) if (l.tags.waterway === 'river') t.linea(l.punti.map(toPx), spessore, [1]);
  }
  if (geoStrade) for (const l of geoStrade.linee) if (l.tags.highway) t.linea(l.punti.map(toPx), spessore, [1]);
  return t.px;
}
// 3. ricerca: pixel immagine (x,y) ↔ riferimento (s·x + tx, s·y + ty); punteggio = pixel dell'immagine che cadono sul riferimento
function cerca(img, rif, W, H, s0, ds, ns, t0, dt, nt) {
  const idx = []; for (let i = 0; i < W * H; i++) if (img[i]) idx.push(i);
  let best = { punti: -1 };
  for (let a = 0; a < ns; a++) {
    const s = s0 + (a - (ns - 1) / 2) * ds;
    for (let b = 0; b < nt; b++) for (let c = 0; c < nt; c++) {
      const tx = t0[0] + (b - (nt - 1) / 2) * dt, ty = t0[1] + (c - (nt - 1) / 2) * dt;
      let punti = 0;
      for (const i of idx) {
        const x = i % W, y = (i - x) / W;
        const X = Math.round(s * x + tx), Y = Math.round(s * y + ty);
        if (X >= 0 && X < W && Y >= 0 && Y < H && rif[Y * W + X]) punti++;
      }
      if (punti > best.punti) best = { punti, s, tx, ty };
    }
  }
  best.frazione = best.punti / idx.length;
  return best;
}

const bbox0 = cfg.bbox;
log(`tema "${TEMA}", riquadro attuale`, JSON.stringify(bbox0));
let W = 512, img = await mascheraImmagine(W), rif = mascheraOSM(bbox0, W, img.H);
log(`  maschera immagine @${W}px: ${img.n} pixel`);
let best = cerca(img.m, rif, W, img.H, 1, 0.004, 31, [0, 0], 2, 41);
log(`grossolano @${W}px: scala ${best.s.toFixed(4)}, spostamento ${best.tx},${best.ty} px, coincidenza ${(best.frazione * 100).toFixed(1)}%`);
const f = 2048 / W; W = 2048; img = await mascheraImmagine(W); rif = mascheraOSM(bbox0, W, img.H);
best = cerca(img.m, rif, W, img.H, best.s, 0.0006, 13, [best.tx * f, best.ty * f], 2, 13);
log(`fine @${W}px: scala ${best.s.toFixed(5)}, spostamento ${best.tx.toFixed(0)},${best.ty.toFixed(0)} px, coincidenza ${(best.frazione * 100).toFixed(1)}%`);

// 4. nuovo riquadro: l'immagine [0,W]×[0,H] cade nel riferimento in [tx, s·W+tx]×[ty, s·H+ty]
const H = img.H;
const mx0 = mercX(bbox0.w), mx1 = mercX(bbox0.e), my0 = mercY(bbox0.n), my1 = mercY(bbox0.s);
const lonDi = (X) => invMercLon(mx0 + (X / W) * (mx1 - mx0)), latDi = (Y) => invMercLat(my0 + (Y / H) * (my1 - my0));
const bbox = { w: +lonDi(best.tx).toFixed(6), e: +lonDi(best.s * W + best.tx).toFixed(6), n: +latDi(best.ty).toFixed(6), s: +latDi(best.s * H + best.ty).toFixed(6) };
const k = 111320 * Math.cos((45.9 * Math.PI) / 180);
log('nuovo riquadro', JSON.stringify(bbox), `(bordo ovest ${Math.round((bbox.w - bbox0.w) * k)} m, est ${Math.round((bbox.e - bbox0.e) * k)} m, nord ${Math.round((bbox.n - bbox0.n) * 110574)} m, sud ${Math.round((bbox.s - bbox0.s) * 110574)} m rispetto a prima)`);

// 5. ritagli di controllo con il NUOVO riquadro: mappa a colori + vettori OSM (strade e acque) in rosso
{
  const Wc = 4096; const { data, info } = await sharp(mappaFile).raw().toBuffer({ resolveWithObject: true });
  const Hc = info.height; const geoA = geoAcque || cache('acque'), geoS = geoStrade || cache('strade');
  const mx = mercX(bbox.w), mx2 = mercX(bbox.e), my = mercY(bbox.n), my2 = mercY(bbox.s);
  const toPx = (c) => [((mercX(c[0]) - mx) / (mx2 - mx)) * Wc, ((mercY(c[1]) - my) / (my2 - my)) * Hc];
  const t = new Tela(Wc, Hc, 1);
  for (const p of geoA.poligoni) t.poligono(p.anelli.map((a) => a.map(toPx)), [1]);
  for (const l of geoS.linee) if (l.tags.highway) t.linea(l.punti.map(toPx), 2.5, [1]);
  for (let i = 0; i < Wc * Hc; i++) if (t.px[i]) { data[i * 3] = 225; data[i * 3 + 1] = 30; data[i * 3 + 2] = 30; }
  const im = sharp(Buffer.from(data.buffer), { raw: { width: Wc, height: Hc, channels: 3 } });
  for (const [nome, l, tp, w, h] of [['laghi', 2300, 250, 520, 260], ['conegliano', 2900, 1300, 560, 400], ['valdobbiadene', 500, 1220, 560, 400], ['nervesa', 2100, 2100, 560, 400]])
    await im.clone().extract({ left: l, top: tp, width: w, height: h }).jpeg({ quality: 85 }).toFile(path.join(DATA, 'cache', `calibrazione-controllo-${nome}.jpg`));
  log('ritagli di controllo in data/cache/calibrazione-controllo-*.jpg');
}

if (APPLICA) {
  cfg.bbox = bbox;
  cfg.calibrazione = { metodo: `registrazione automatica su vettori OSM (tema ${TEMA})`, scala: +best.s.toFixed(5), coincidenza: +(best.frazione * 100).toFixed(1), data: new Date().toISOString().slice(0, 10), riquadroPrecedente: bbox0 };
  fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  log('config.json aggiornato. Ora: node tools/build-data.mjs --solo=terreno  e  node tools/build-data.mjs --solo=colori');
} else log('prova a secco: aggiungi --applica per scrivere il riquadro in config.json');
