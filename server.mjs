// Server della Mappa turistica del Prosecco: pagine statiche, dati del plastico e API del backend.
// Avvio: node server.mjs [--port 5800]   (password admin: variabile ADMIN_PASSWORD, oppure file .env, default "prosecco")
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

// .env minimale
if (fs.existsSync(path.join(ROOT, '.env'))) for (const riga of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = riga.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const argPort = process.argv.indexOf('--port');
const PORT = +(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT || 5800);
const PASSWORD = process.env.ADMIN_PASSWORD || 'prosecco';

const app = express();
app.use(express.json({ limit: '20mb' }));

// ── Dati su file JSON (semplici, versionabili, modificabili anche a mano) ──
const FILE = { config: 'config.json', poi: 'poi.json', itinerari: 'itinerari.json', foto360: 'foto360.json' };
const DEFAULT = { config: {}, poi: [], itinerari: [], foto360: [] };
const leggi = (k) => { const f = path.join(DATA, FILE[k]); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : structuredClone(DEFAULT[k]); };
const scrivi = (k, v) => {
  const f = path.join(DATA, FILE[k]);
  if (fs.existsSync(f)) { // copia di sicurezza dell'ultima versione
    fs.mkdirSync(path.join(DATA, 'backup'), { recursive: true });
    fs.copyFileSync(f, path.join(DATA, 'backup', FILE[k].replace('.json', '') + '.prec.json'));
  }
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
};

// ── Autenticazione admin: token in memoria dopo il login ──
const tokens = new Set();
app.post('/api/login', (req, res) => {
  if ((req.body?.password || '') !== PASSWORD) return res.status(401).json({ errore: 'Password errata' });
  const t = crypto.randomBytes(24).toString('hex'); tokens.add(t);
  res.json({ token: t });
});
const admin = (req, res, next) => {
  const t = req.get('x-admin-token') || req.query.token;
  if (t && tokens.has(t)) return next();
  res.status(401).json({ errore: 'Accesso riservato: effettua il login nel backend' });
};

// ── API pubbliche ──
for (const k of Object.keys(FILE)) app.get('/api/' + k, (req, res) => res.json(leggi(k)));
app.get('/api/stato', (req, res) => {
  const c = leggi('config');
  res.json({ titolo: c.titolo, terreno: !!c.terreno && fs.existsSync(path.join(DATA, 'altimetria.png')), colori: fs.existsSync(path.join(DATA, 'colori.jpg')),
    poi: leggi('poi').length, itinerari: leggi('itinerari').length, foto360: leggi('foto360').length });
});

// ── API del backend (richiedono il token) ──
app.put('/api/config', admin, (req, res) => { const c = { ...leggi('config'), ...req.body }; scrivi('config', c); res.json(c); });
for (const k of ['poi', 'itinerari', 'foto360']) {
  app.put('/api/' + k, admin, (req, res) => { if (!Array.isArray(req.body)) return res.status(400).json({ errore: 'atteso un elenco' }); scrivi(k, req.body); res.json({ ok: true, n: req.body.length }); });
  app.post('/api/' + k, admin, (req, res) => {
    const lista = leggi(k); const el = req.body;
    if (!el?.id) el.id = (el.nome || k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
    if (lista.some((x) => x.id === el.id)) return res.status(409).json({ errore: 'id già esistente' });
    lista.push(el); scrivi(k, lista); res.json(el);
  });
  app.put('/api/' + k + '/:id', admin, (req, res) => {
    const lista = leggi(k); const i = lista.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ errore: 'non trovato' });
    lista[i] = { ...lista[i], ...req.body, id: req.params.id }; scrivi(k, lista); res.json(lista[i]);
  });
  app.delete('/api/' + k + '/:id', admin, (req, res) => {
    const lista = leggi(k).filter((x) => x.id !== req.params.id); scrivi(k, lista); res.json({ ok: true });
  });
}

// Caricamento file multimediali (immagini, video, audio, foto 360, modelli GLB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => { const d = path.join(UPLOADS, (req.query.cartella || 'media').replace(/[^a-z0-9/_-]/gi, '')); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
  filename: (req, file, cb) => cb(null, Date.now().toString(36) + '-' + file.originalname.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-')),
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });
app.post('/api/upload', admin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ errore: 'nessun file' });
  res.json({ url: path.relative(ROOT, req.file.path).replace(/\\/g, '/'), nome: req.file.originalname, dimensione: req.file.size, tipo: req.file.mimetype });
});

// Ricalcolo del tracciato di un itinerario sulla rete stradale (OSRM, progetto OpenStreetMap)
app.post('/api/itinerari/:id/traccia', admin, async (req, res) => {
  const lista = leggi('itinerari'); const it = lista.find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ errore: 'non trovato' });
  const poi = leggi('poi');
  const pts = (req.body?.tappe || it.tappe || []).map((t) => Array.isArray(t) ? t : (() => { const p = poi.find((x) => x.id === t); return p ? [p.lon, p.lat] : null; })()).filter(Boolean);
  if (pts.length < 2) return res.status(400).json({ errore: 'servono almeno due tappe valide' });
  try {
    const profilo = req.body?.profilo || 'driving';
    const u = `https://router.project-osrm.org/route/v1/${profilo}/${pts.map((c) => c.join(',')).join(';')}?overview=full&geometries=geojson&continue_straight=false`;
    const r = await fetch(u, { headers: { 'User-Agent': 'mappa-turistica-prosecco/0.1' } });
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error(j.code + ' ' + (j.message || ''));
    it.geometria = j.routes[0].geometry.coordinates.map((c) => [+c[0].toFixed(5), +c[1].toFixed(5)]);
    it.km = +(j.routes[0].distance / 1000).toFixed(1); it.fonte = 'osrm';
    if (req.body?.tappe) it.tappe = req.body.tappe;
    scrivi('itinerari', lista); res.json(it);
  } catch (e) { res.status(502).json({ errore: 'OSRM non disponibile: ' + e.message }); }
});

// ── File statici ──
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));
app.use('/data', express.static(DATA, { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOADS, { maxAge: '1d' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Mappa turistica del Prosecco → http://localhost:${PORT}   (backend: http://localhost:${PORT}/admin)`);
  if (PASSWORD === 'prosecco') console.log('  password admin predefinita "prosecco": cambiala con ADMIN_PASSWORD nel file .env');
});
