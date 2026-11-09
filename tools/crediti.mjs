// Crediti e licenze delle foto dei monumenti: per ogni immagine dei POI cerca il file omonimo su Wikimedia Commons e,
// se lo trova, scrive nel media `credito` (autore + licenza), `licenza`, `licenzaUrl`, `fonteUrl`. Le immagini non trovate
// (foto del committente o rinominate) restano senza credito e vengono elencate alla fine: vanno verificate a mano.
//
// Uso: node tools/crediti.mjs ["<cartella materiali>"]   (la cartella serve solo per risalire ai nomi originali dei file)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const poiFile = path.join(ROOT, 'data/poi.json');
const SRC = process.argv[2] || 'C:/Users/manue/Downloads/wetransfer_materiali-per-mappa-prosecco_2026-11-05_1914/IMMAGINI 15 MONUMENTI';
const UA = 'mappa-turistica-prosecco/0.1 (verifica licenze; manuel.92.avanzi@gmail.com)';
const log = (...a) => console.log('[crediti]', ...a);
const pulisci = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

// nome originale → nome slug (come importa-materiali.mjs), cercando in tutte le sottocartelle dei materiali
const originali = new Map();
const cerca = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) cerca(p); else if (/\.(jpe?g|png|jfif|webp)$/i.test(f.name)) originali.set(pulisci(path.parse(f.name).name), path.parse(f.name).name); } };
if (fs.existsSync(SRC)) cerca(SRC); else log('cartella materiali non trovata: uso i titoli dei media come nomi');

const pulisciHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
async function commons(nome) {
  // varianti del nome: com'è, senza "(1)" finale, senza prefisso 1920px-/3840px-, estensioni diverse
  const basi = [...new Set([nome, nome.replace(/\s*\(\d+\)$/, ''), nome.replace(/^\d+px-/, ''), nome.replace(/^\d+px-/, '').replace(/\s*\(\d+\)$/, ''),
    nome.replace(/\s*\(foto (.+)\)$/i, ' - Foto di $1')])]; // il titolo "(foto X)" deriva da "- Foto di X" nel nome originale
  const titoli = [...new Set(basi.flatMap((b) => ['.jpg', '.JPG', '.jpeg', '.png', '.JPEG', '.PNG'].map((e) => 'File:' + b.replace(/ /g, '_') + e)))].slice(0, 50);
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata|url&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|Credit|AttributionRequired|ObjectName&titles=' + encodeURIComponent(titoli.join('|'));
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  for (const pg of Object.values(j.query?.pages || {})) {
    const ii = pg.imageinfo?.[0]; if (!ii) continue;
    const m = ii.extmetadata || {};
    return {
      titolo: pg.title, autore: pulisciHtml(m.Artist?.value) || null, licenza: m.LicenseShortName?.value || null, licenzaUrl: m.LicenseUrl?.value || null,
      fonteUrl: ii.descriptionurl, attribuzione: m.AttributionRequired?.value !== 'false',
    };
  }
  return null;
}

const poi = JSON.parse(fs.readFileSync(poiFile, 'utf8'));
let trovati = 0; const mancanti = [];
for (const p of poi) for (const m of p.media || []) {
  if (m.tipo !== 'immagine' || !m.url?.startsWith('uploads/poi/')) continue;
  if (m.credito && !process.argv.includes('--tutti')) { trovati++; continue; } // già risolto
  const slug = path.parse(m.url).name;
  const nome = originali.get(slug) || m.titolo;
  let info = null;
  try { info = await commons(nome); } catch (e) { log(`  ${nome}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 250));
  if (!info) { mancanti.push(`${p.nome} → ${nome}`); continue; }
  const autore = info.autore && info.autore.length < 80 ? info.autore : (info.autore ? info.autore.slice(0, 77) + '…' : 'autore non indicato');
  m.credito = `${autore}, ${info.licenza || 'licenza da verificare'}, via Wikimedia Commons`;
  m.licenza = info.licenza; m.licenzaUrl = info.licenzaUrl; m.fonteUrl = info.fonteUrl; m.fonte = 'Wikimedia Commons';
  trovati++;
  log(`  ${p.nome}: ${nome} → ${info.licenza} (${autore})`);
}
fs.writeFileSync(poiFile, JSON.stringify(poi, null, 2) + '\n');
log(`trovate su Commons: ${trovati}; senza credito (da verificare a mano): ${mancanti.length}`);
for (const x of mancanti) log('  ? ' + x);
// riepilogo per licenza
const conta = {}; for (const p of poi) for (const m of p.media || []) if (m.licenza) conta[m.licenza] = (conta[m.licenza] || 0) + 1;
log('licenze:', JSON.stringify(conta));
