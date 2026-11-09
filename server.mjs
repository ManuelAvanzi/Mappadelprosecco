// Server della Mappa turistica del Prosecco: pagine statiche, dati del plastico e API del backend.
// Avvio: node server.mjs [--port 5800]   (password admin: variabile ADMIN_PASSWORD, oppure file .env, default "prosecco")
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// .env minimale
if (fs.existsSync(path.join(ROOT, '.env'))) for (const riga of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = riga.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

// Cartelle dei dati e dei file caricati. In hosting (Render, Docker) si spostano su un disco persistente con DATA_DIR e
// UPLOADS_DIR: al primo avvio vengono riempite con il contenuto del repository (dati del plastico, foto dei monumenti).
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOADS = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(ROOT, 'uploads');
const semina = (da, a) => {
  if (path.resolve(da) === path.resolve(a) || !fs.existsSync(da)) return;
  fs.mkdirSync(a, { recursive: true });
  for (const f of fs.readdirSync(da, { withFileTypes: true })) {
    if (f.name === 'cache' || f.name === 'backup') continue;
    const s = path.join(da, f.name), d = path.join(a, f.name);
    if (f.isDirectory()) semina(s, d); else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
};
semina(path.join(ROOT, 'data'), DATA); semina(path.join(ROOT, 'uploads'), UPLOADS);
fs.mkdirSync(UPLOADS, { recursive: true });
const argPort = process.argv.indexOf('--port');
const PORT = +(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT || 5800);
const PASSWORD = process.env.ADMIN_PASSWORD || 'prosecco';
const PRODUZIONE = process.env.NODE_ENV === 'production';
// in produzione il backend si attiva solo con una password impostata (mai quella predefinita)
const ADMIN_ATTIVO = !(PRODUZIONE && (PASSWORD === 'prosecco' || PASSWORD.length < 8));

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); next(); });
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
const tokens = new Map(); // token → scadenza (ms)
const DURATA_TOKEN = 12 * 3600 * 1000;
// tentativi di login per indirizzo: dopo 5 errori si aspetta 15 minuti
const tentativi = new Map();
const ipDi = (req) => (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || req.socket.remoteAddress || '?';
const confrontoSicuro = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
app.post('/api/login', (req, res) => {
  if (!ADMIN_ATTIVO) return res.status(503).json({ errore: 'Backend disattivato: imposta ADMIN_PASSWORD (almeno 8 caratteri) sul server' });
  const ip = ipDi(req), t0 = tentativi.get(ip) || { n: 0, fino: 0 };
  if (t0.fino > Date.now()) return res.status(429).json({ errore: `Troppi tentativi: riprova tra ${Math.ceil((t0.fino - Date.now()) / 60000)} minuti` });
  if (!confrontoSicuro(req.body?.password || '', PASSWORD)) {
    t0.n++; if (t0.n >= 5) { t0.n = 0; t0.fino = Date.now() + 15 * 60000; } tentativi.set(ip, t0);
    return res.status(401).json({ errore: 'Password errata' });
  }
  tentativi.delete(ip);
  const t = crypto.randomBytes(24).toString('hex'); tokens.set(t, Date.now() + DURATA_TOKEN);
  res.json({ token: t });
});
const admin = (req, res, next) => {
  const t = req.get('x-admin-token') || req.query.token;
  if (t && tokens.has(t)) { if (tokens.get(t) > Date.now()) return next(); tokens.delete(t); }
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
// solo tipi di file previsti: immagini, video, audio, modelli GLB (niente script o pagine)
const ESTENSIONI = /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v|mp3|m4a|aac|ogg|oga|wav|flac|glb)$/i;
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, ESTENSIONI.test(file.originalname)) });
app.post('/api/upload', admin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ errore: 'nessun file, oppure tipo di file non ammesso (immagini, video, audio, GLB)' });
  res.json({ url: 'uploads/' + path.relative(UPLOADS, req.file.path).replace(/\\/g, '/'), nome: req.file.originalname, dimensione: req.file.size, tipo: req.file.mimetype });
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

app.get('/salute', (req, res) => res.json({ ok: true, admin: ADMIN_ATTIVO }));

app.listen(PORT, () => {
  console.log(`Mappa turistica del Prosecco → http://localhost:${PORT}   (backend: http://localhost:${PORT}/admin)`);
  console.log(`  dati: ${DATA}   file caricati: ${UPLOADS}`);
  if (!ADMIN_ATTIVO) console.log('  ATTENZIONE: backend DISATTIVATO perché ADMIN_PASSWORD manca o è troppo corta (produzione)');
  else if (PASSWORD === 'prosecco') console.log('  password admin predefinita "prosecco": cambiala con ADMIN_PASSWORD nel file .env');
});
