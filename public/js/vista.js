// Pannello "Visualizzazione": cursori per ambiente, luce, effetti e inquadratura, con salvataggio del predefinito nel backend.
import { OPZIONI } from './ambiente.js';

const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(innerWidth, innerHeight) < 760);
export const PREDEFINITI = {
  fondale: 'cielo', tavolo: 'legno', nuvole: 0.3, nebbia: 0.5,
  ora: 15.5, sole: 1, ambiente: 1, ombre: !mobile, esposizione: 1.05,
  effetti: !mobile, miniatura: 0.35, vignetta: 0.25, saturazione: 1.1, contrasto: 1.05, temperatura: 0, bagliore: 0.15, contorni: 0, grana: 0,
  proiezione: 'orto', elevazione: 42, azimut: 0, zoom: 1, focale: 45, esagerazione: 1.7,
};
const NOMI_TAVOLO = { legno: 'legno chiaro', noce: 'noce', feltro: 'feltro verde', grigio: 'grigio studio', carta: 'carta millimetrata', nero: 'nero', nessuno: 'nessun tavolo' };

// sezione → controlli: [chiave, etichetta, tipo, min, max, passo, formato]
const SCHEMA = [
  ['Ambiente', [
    ['fondale', 'Fondale', 'select', { studio: 'studio (sfumatura)', cielo: 'cielo con sole' }],
    ['tavolo', 'Tavolo', 'select', Object.fromEntries([...OPZIONI.tavolo, 'nessuno'].map((k) => [k, NOMI_TAVOLO[k] || k]))],
    ['nuvole', 'Nuvole', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
    ['nebbia', 'Foschia in lontananza', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
  ]],
  ['Luce', [
    ['ora', 'Ora del giorno', 'range', 5, 21, 0.25, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`],
    ['sole', 'Sole', 'range', 0, 2, 0.05, (v) => Math.round(v * 100)],
    ['ambiente', 'Luce diffusa', 'range', 0, 2, 0.05, (v) => Math.round(v * 100)],
    ['esposizione', 'Esposizione', 'range', 0.5, 1.8, 0.05, (v) => v.toFixed(2)],
    ['ombre', 'Ombre del sole', 'check'],
  ]],
  ['Effetti', [
    ['effetti', 'Effetti attivi', 'check'],
    ['miniatura', 'Effetto miniatura', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
    ['vignetta', 'Vignettatura', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
    ['saturazione', 'Saturazione', 'range', 0.5, 1.6, 0.02, (v) => Math.round(v * 100)],
    ['contrasto', 'Contrasto', 'range', 0.7, 1.4, 0.02, (v) => Math.round(v * 100)],
    ['temperatura', 'Temperatura colore', 'range', -1, 1, 0.05, (v) => Math.round(v * 100)],
    ['bagliore', 'Bagliore', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
    ['contorni', 'Contorni a inchiostro', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
    ['grana', 'Grana di pellicola', 'range', 0, 1, 0.05, (v) => Math.round(v * 100)],
  ]],
  ['Inquadratura', [
    ['proiezione', 'Proiezione', 'select', { orto: 'assonometria', prospettiva: 'prospettiva' }],
    ['elevazione', 'Altezza della camera', 'range', 10, 85, 1, (v) => v + '°'],
    ['azimut', 'Rotazione (0 = da sud)', 'range', -180, 180, 5, (v) => v + '°'],
    ['zoom', 'Ingrandimento', 'range', 0.5, 3, 0.05, (v) => v.toFixed(2) + '×'],
    ['focale', 'Focale (prospettiva)', 'range', 20, 80, 1, (v) => v + '°'],
    ['esagerazione', 'Esagerazione del rilievo', 'range', 1, 3, 0.1, (v) => v.toFixed(1) + '×'],
  ]],
];
const CAMERA = new Set(['proiezione', 'elevazione', 'azimut', 'zoom', 'focale']);

export class Vista {
  constructor(app, corpo) {
    this.app = app; this.corpo = corpo;
    this.valori = { ...PREDEFINITI, ...(app.cfg.vista || {}) };
    this.costruisci();
  }
  costruisci() {
    const c = this.corpo; c.innerHTML = '';
    for (const [titolo, controlli] of SCHEMA) {
      const det = document.createElement('details'); det.open = titolo === 'Luce' || titolo === 'Ambiente';
      det.innerHTML = `<summary>${titolo}</summary>`;
      for (const [k, nome, tipo, a, b, passo, fmt] of controlli) {
        const lab = document.createElement('label'); lab.className = 'ctrl ' + tipo; lab.dataset.k = k;
        if (tipo === 'range') {
          lab.innerHTML = `<span>${nome}</span><output></output><input type="range" min="${a}" max="${b}" step="${passo}">`;
          const inp = lab.querySelector('input'), out = lab.querySelector('output');
          inp.value = this.valori[k]; out.textContent = fmt(+inp.value);
          inp.addEventListener('input', () => { this.valori[k] = +inp.value; out.textContent = fmt(+inp.value); this.applica(k); });
        } else if (tipo === 'check') {
          lab.innerHTML = `<span>${nome}</span><input type="checkbox">`;
          const inp = lab.querySelector('input'); inp.checked = !!this.valori[k];
          inp.addEventListener('change', () => { this.valori[k] = inp.checked; this.applica(k); });
        } else {
          lab.innerHTML = `<span>${nome}</span><select>${Object.entries(a).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`;
          const sel = lab.querySelector('select'); sel.value = this.valori[k];
          sel.addEventListener('change', () => { this.valori[k] = sel.value; this.applica(k); });
        }
        det.appendChild(lab);
      }
      c.appendChild(det);
    }
    const az = document.createElement('div'); az.className = 'azioni';
    az.innerHTML = `<button class="bottone primario" id="vista-aerea">Veduta aerea con questi valori</button>
      <button class="bottone" id="vista-salva">Salva come predefinito</button>
      <button class="bottone" id="vista-reset">Ripristina</button>
      <span class="vuoto" id="vista-esito"></span>`;
    c.appendChild(az);
    az.querySelector('#vista-aerea').addEventListener('click', () => this.app.vedutaAerea());
    az.querySelector('#vista-reset').addEventListener('click', () => { this.valori = { ...PREDEFINITI, ...(this.app.cfg.vista || {}) }; this.costruisci(); this.applica(); this.app.vedutaAerea(); });
    az.querySelector('#vista-salva').addEventListener('click', () => this.salva());
  }
  /** applica tutto (o la sola chiave cambiata) alla scena */
  applica(k) {
    const v = this.valori;
    if (!k || !CAMERA.has(k) && k !== 'esagerazione') { this.app.ambiente.applica(v); this.app.post.setLook(v); }
    if (k === 'esagerazione') this.app.impostaEsagerazione(v.esagerazione);
    if (k && CAMERA.has(k)) this.app.vedutaAerea(true);
    this.corpo.querySelector('[data-k=focale]')?.classList.toggle('spento', v.proiezione !== 'prospettiva');
    for (const kk of ['miniatura', 'vignetta', 'saturazione', 'contrasto', 'temperatura', 'bagliore', 'contorni', 'grana']) this.corpo.querySelector(`[data-k=${kk}]`)?.classList.toggle('spento', !v.effetti);
  }
  async salva() {
    const esito = this.corpo.querySelector('#vista-esito');
    let token = sessionStorage.getItem('token');
    try {
      if (!token) {
        const pw = prompt('Password del backend per salvare il predefinito:'); if (pw == null) return;
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
        if (!r.ok) throw new Error('password errata'); token = (await r.json()).token; sessionStorage.setItem('token', token);
      }
      const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ vista: this.valori, esagerazione: this.valori.esagerazione }) });
      if (!r.ok) { sessionStorage.removeItem('token'); throw new Error('salvataggio rifiutato'); }
      this.app.cfg.vista = { ...this.valori }; esito.textContent = 'Predefinito salvato: lo vedranno tutti al prossimo caricamento.';
    } catch (e) { esito.textContent = 'Non salvato: ' + e.message; }
  }
}
