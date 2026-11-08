// Importa i materiali ricevuti (cartella WeTransfer "materiali per mappa prosecco"):
//   - le tre mappe GRANDE (stradale, rilievo, satellite) ridotte a 4096 px   -> public/mappe/*.jpg
//   - le foto dei 15 monumenti ridotte a 1600 px                              -> uploads/poi/<id>/*.jpg  + voci "media" in data/poi.json
//   - il modello GLB Meshy della Pieve di San Pietro di Feletto (versione leggera) -> public/modelli/
//
// Uso:  node tools/importa-materiali.mjs "<cartella con lo zip estratto>"
//   La cartella deve contenere "MAPPA STRADALE GRANDE.jpg", "MAPPA RILIEVO GRANDE.jpg", "MAPPA SATELLITE GRANDE.jpg"
//   e la cartella "IMMAGINI 15 MONUMENTI". Si può rilanciare: le immagini già presenti non vengono duplicate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LUOGHI } from './luoghi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('Indica la cartella dei materiali estratti.'); process.exit(1); }
const log = (...a) => console.log('[materiali]', ...a);

// 1. Mappe fornite
const MAPPE = { stradale: 'MAPPA STRADALE GRANDE.jpg', rilievo: 'MAPPA RILIEVO GRANDE.jpg', satellite: 'MAPPA SATELLITE GRANDE.jpg' };
fs.mkdirSync(path.join(ROOT, 'public/mappe'), { recursive: true });
for (const [id, nome] of Object.entries(MAPPE)) {
  const src = path.join(SRC, nome), dst = path.join(ROOT, 'public/mappe', id + '.jpg');
  if (!fs.existsSync(src)) { log(`manca ${nome}`); continue; }
  if (fs.existsSync(dst)) { log(`${id}.jpg già presente`); continue; }
  await sharp(src).resize({ width: 4096 }).jpeg({ quality: 82 }).toFile(dst);
  log(`${id}.jpg → ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB`);
}

// 2. Modello GLB della Pieve (la versione leggera da 0,6 MB; quella da 11 MB è troppo pesante per il web)
const glbSrc = path.join(SRC, 'IMMAGINI 15 MONUMENTI/san pietro di feletto/Meshy_AI_Church_with_Bell_Towe_1105170859_generate.glb');
const glbDst = path.join(ROOT, 'public/modelli/pieve-san-pietro-di-feletto.glb');
fs.mkdirSync(path.dirname(glbDst), { recursive: true });
if (fs.existsSync(glbSrc) && !fs.existsSync(glbDst)) { fs.copyFileSync(glbSrc, glbDst); log('pieve-san-pietro-di-feletto.glb copiato'); }

// 3. Foto dei monumenti → media dei POI
const poiFile = path.join(ROOT, 'data/poi.json');
if (!fs.existsSync(poiFile)) { log('data/poi.json non esiste: esegui prima `npm run dati`'); process.exit(1); }
const poi = JSON.parse(fs.readFileSync(poiFile, 'utf8'));
const base = path.join(SRC, 'IMMAGINI 15 MONUMENTI');
const pulisci = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
let n = 0;
for (const L of LUOGHI.filter((l) => l.tipo === 'monumento' && l.cartella)) {
  const dir = path.join(base, L.cartella);
  if (!fs.existsSync(dir)) { log(`cartella mancante: ${L.cartella}`); continue; }
  const p = poi.find((x) => x.id === L.id);
  if (!p) continue;
  p.media = p.media || [];
  const outDir = path.join(ROOT, 'uploads/poi', L.id);
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|jfif|webp)$/i.test(f)).sort();
  for (const f of files) {
    const nomeOut = pulisci(path.parse(f).name) + '.jpg';
    const url = `uploads/poi/${L.id}/${nomeOut}`;
    if (p.media.some((m) => m.url === url)) continue;
    try {
      await sharp(path.join(dir, f)).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(path.join(outDir, nomeOut));
      const titolo = path.parse(f).name.replace(/_/g, ' ').replace(/\s*\(\d+\)$/, '').replace(/ - Foto di (.+)$/i, ' (foto $1)');
      p.media.push({ tipo: 'immagine', url, titolo });
      n++;
    } catch (e) { log(`  ${f}: ${e.message}`); }
  }
  // la prima immagine diventa la copertina
  if (!p.copertina && p.media.length) p.copertina = p.media[0].url;
}
fs.writeFileSync(poiFile, JSON.stringify(poi, null, 2) + '\n');
log(`${n} immagini importate nei media dei monumenti`);
