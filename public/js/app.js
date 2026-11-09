// Mappa turistica del Prosecco — applicazione principale: scena, camere, menu e collegamento dei moduli.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Geo } from './geo.js';
import { Terreno } from './terreno.js';
import { Etichette } from './etichette.js';
import { Modelli } from './modelli.js';
import { Itinerari, Percorso } from './itinerari.js';
import { PannelloPoi } from './poi.js';
import { Foto360 } from './foto360.js';
import { Ambiente } from './ambiente.js';
import { creaPost } from './post.js';
import { Vista } from './vista.js';
import { Dettaglio } from './dettaglio.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FOV = 45;

class App {
  async avvia() {
    const prog = (t) => { $('#caricamento-testo').textContent = t; };
    prog('Lettura dei dati…');
    [this.cfg, this.poi, this.itinerariDati, this.foto360] = await Promise.all(['config', 'poi', 'itinerari', 'foto360'].map((k) => fetch('/api/' + k).then((r) => r.json())));
    if (!this.cfg.bbox) { prog('Dati del plastico assenti: esegui "npm run dati" e ricarica.'); return; }
    document.title = this.cfg.titolo || document.title; $('#titolo').textContent = this.cfg.titolo || 'Mappa turistica del Prosecco';
    this.geo = new Geo(this.cfg.bbox);

    // scena, renderer, camere
    this.scena = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    $('#scena').appendChild(this.renderer.domElement);
    const asp = innerWidth / innerHeight;
    this.camProsp = new THREE.PerspectiveCamera(FOV, asp, 5, this.geo.larghezza * 6);
    const hOrto = this.geo.altezza * 0.62;
    this.camOrto = new THREE.OrthographicCamera(-hOrto * asp, hOrto * asp, hOrto, -hOrto, -this.geo.larghezza * 4, this.geo.larghezza * 6);
    this.camera = this.camOrto;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06; this.controls.minDistance = 150; this.controls.maxDistance = this.geo.larghezza * 2.2;
    this.controls.minZoom = 0.35; this.controls.maxZoom = 60; this.controls.screenSpacePanning = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // terreno, poi ambiente (tavolo, cielo, luci) e post-produzione
    this.terreno = new Terreno(this.geo, this.cfg);
    if (this.cfg.vista?.esagerazione) this.terreno.esagerazione = this.cfg.vista.esagerazione;
    await this.terreno.carica(prog);
    this.scena.add(this.terreno.gruppo);
    this.dettaglio = new Dettaglio(this.terreno, this.cfg); this.dettaglio.impostaRenderer(this.renderer);
    prog('Ambiente e luci…');
    this.ambiente = new Ambiente(this.scena, this.renderer, this.terreno, this.geo);
    this.post = creaPost(this.renderer); this.post.setSize(innerWidth, innerHeight);
    this.vista = new Vista(this, $('#vista-corpo'));
    this.vista.applica();

    // etichette, modelli, itinerari, foto 360
    prog('Punti di interesse…');
    this.etichette = new Etichette(this.scena, this.terreno, this.cfg, $('#etichette'));
    this.etichette.onClick = (d, tipo) => (tipo === 'poi' ? this.apriPoi(d) : this.foto.apri(d.id));
    for (const p of this.poi) this.etichette.aggiungiPoi(p);
    for (const f of this.foto360) if (f.lat && f.lon) this.etichette.aggiungiFoto360(f);
    this.modelli = new Modelli(this.scena, this.terreno, this.cfg);
    await Promise.all(this.poi.filter((p) => p.modello && p.visibile !== false).map((p) => this.modelli.aggiungi(p)));
    this.itinerari = new Itinerari(this.scena, this.terreno, this.geo, this.cfg);
    this.itinerari.carica(this.itinerariDati);
    for (const it of this.itinerariDati) for (const a of it.audio || []) this.etichette.aggiungiAudio(a, it.id);
    this.pannelloPoi = new PannelloPoi(this);
    this.foto = new Foto360(this);
    this.percorso = new Percorso(this.terreno, this.geo, this.camProsp, {
      nome: $('#percorso-nome'), km: $('#percorso-km'), barra: $('#percorso-avanzamento'), play: $('#percorso-play'),
      audio: $('#percorso-audio'), audioTitolo: $('#percorso-audio-titolo'), audioPlayer: $('#percorso-audio-player'),
    });

    this.raycaster = new THREE.Raycaster();
    this.modalita = 'aerea';
    this.ui();
    this.vedutaAerea(true);
    addEventListener('resize', () => this.ridimensiona());
    this.orologio = new THREE.Clock();
    this.anima();
    $('#caricamento').classList.add('via');
    setTimeout(() => $('#caricamento')?.remove(), 900);
    window.__mappa = this; // per il collaudo dalla console
  }

  // ── camere ──
  /** coordinate UV (u verso est, v verso sud) del punto del plastico che la camera guarda: il bersaglio dei controlli, o nel percorso il terreno davanti alla camera */
  puntoOsservato() {
    let p = this.controls.target;
    if (this.modalita === 'percorso') {
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      p = this.camera.position.clone();
      for (let s = 0; s < 60; s++) { p.addScaledVector(dir, 25); if (p.y <= this.terreno.quotaLocale(p.x, p.z)) break; }
    }
    const [lon, lat] = this.geo.aGeo(p.x, p.z);
    return this.geo.aUV(lon, lat);
  }
  distanzaEquivalente() {
    if (this.camera.isOrthographicCamera) return (this.camera.top - this.camera.bottom) / this.camera.zoom / (2 * Math.tan((FOV * Math.PI) / 360));
    return this.camera.position.distanceTo(this.controls.target);
  }
  usaCamera(cam) {
    if (this.camera === cam) return;
    const t = this.controls.target.clone();
    const d = this.distanzaEquivalente();
    const dir = this.camera.position.clone().sub(t).normalize();
    this.camera = cam; this.controls.object = cam;
    if (cam.isOrthographicCamera) { cam.position.copy(t).addScaledVector(dir, this.geo.larghezza); cam.zoom = (cam.top - cam.bottom) / (2 * Math.tan((FOV * Math.PI) / 360) * d); cam.updateProjectionMatrix(); }
    else { cam.position.copy(t).addScaledVector(dir, d); }
    cam.lookAt(t); this.controls.update();
    $('#btn-proiezione').classList.toggle('attivo', cam.isOrthographicCamera);
  }
  /** Veduta aerea: tutto il territorio da sud (o dalla rotazione scelta), in assonometria o prospettiva secondo la Visualizzazione */
  vedutaAerea(subito = false) {
    this.esciPercorso();
    this.modalita = 'aerea'; this.menuAttivo('aerea');
    const v = this.vista.valori;
    const orto = v.proiezione !== 'prospettiva';
    this.camProsp.fov = v.focale; this.camProsp.updateProjectionMatrix();
    this.usaCamera(orto ? this.camOrto : this.camProsp);
    const t = new THREE.Vector3(0, this.terreno.quotaMin * this.terreno.esagerazione, 0);
    const el = THREE.MathUtils.degToRad(v.elevazione), az = THREE.MathUtils.degToRad(v.azimut);
    // su schermi stretti (telefono in verticale) il plastico, più largo che alto, deve entrare in larghezza: si allarga l'inquadratura
    const fit = Math.min(1, (innerWidth / innerHeight) / 1.4);
    const d = orto ? this.geo.larghezza * 1.2 : (this.geo.larghezza * 0.62 / Math.tan(THREE.MathUtils.degToRad(v.focale) / 2)) / (v.zoom * fit);
    const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(t);
    this.volaCamera(pos, t, subito ? 0 : 1.2, orto ? v.zoom * fit : undefined);
  }
  volaCamera(pos, target, durata = 1.2, zoom) {
    const cam = this.camera;
    const p0 = cam.position.clone(), t0 = this.controls.target.clone(), z0 = cam.zoom;
    if (!durata) { cam.position.copy(pos); this.controls.target.copy(target); if (zoom) { cam.zoom = zoom; cam.updateProjectionMatrix(); } this.controls.update(); return; }
    const t1 = performance.now();
    this.volo = (ora) => {
      const k = Math.min(1, (ora - t1) / (durata * 1000)), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.position.lerpVectors(p0, pos, e); this.controls.target.lerpVectors(t0, target, e);
      if (zoom && cam.isOrthographicCamera) { cam.zoom = z0 + (zoom - z0) * e; cam.updateProjectionMatrix(); }
      if (k >= 1) this.volo = null;
    };
  }
  /** avvicina la camera a un punto di interesse (prospettiva, da sud, ~1,6 km) */
  volaA(p, distanza = 1600) {
    this.esciPercorso();
    this.usaCamera(this.camProsp);
    const t = this.terreno.posizione(p.lon, p.lat, 0);
    const el = THREE.MathUtils.degToRad(38);
    const pos = new THREE.Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(distanza).add(t);
    this.volaCamera(pos, t, 1.4);
  }
  inquadraBox(box) {
    this.usaCamera(this.camProsp);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = Math.max(s.x, s.z) * 1.1 + 1500;
    const el = THREE.MathUtils.degToRad(45);
    this.volaCamera(new THREE.Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(d).add(c), c, 1.4);
  }

  // ── interfaccia ──
  ui() {
    $('#menu').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const az = b.dataset.azione;
      if (az === 'aerea') { this.chiudiPannello(); this.chiudiDettaglio(); this.vedutaAerea(); return; }
      if (this.pannelloAperto === az) { this.chiudiPannello(); this.menuAttivo(this.modalita === 'aerea' ? 'aerea' : null); return; }
      this.apriPannello(az);
    });
    $('#pannello-chiudi').addEventListener('click', () => { this.chiudiPannello(); this.menuAttivo(this.modalita === 'aerea' ? 'aerea' : null); });
    $('#dettaglio-chiudi').addEventListener('click', () => this.chiudiDettaglio());
    $('#btn-proiezione').addEventListener('click', () => {
      if (this.modalita === 'percorso') return; // nel percorso la camera è sempre prospettica
      const orto = !this.camera.isOrthographicCamera;
      this.vista.valori.proiezione = orto ? 'orto' : 'prospettiva'; // tiene allineato il pannello Visualizzazione
      const sel = $('#vista-corpo [data-k=proiezione] select'); if (sel) { sel.value = this.vista.valori.proiezione; this.vista.applica(); }
      this.usaCamera(orto ? this.camOrto : this.camProsp);
    });
    $('#btn-mappe').addEventListener('click', () => (this.pannelloAperto === 'mappe' ? this.chiudiPannello() : this.apriPannello('mappe')));
    $('#btn-vista').addEventListener('click', () => this.mostraVista($('#vista').classList.contains('chiuso')));
    $('#vista-chiudi').addEventListener('click', () => this.mostraVista(false));
    // percorso animato
    $('#percorso-play').addEventListener('click', () => this.percorso.play());
    $('#percorso-indietro').addEventListener('click', () => { this.percorso.vaiA(0); this.percorso.play(false); });
    $('#percorso-esci').addEventListener('click', () => this.vedutaAerea());
    $('#percorso-avanzamento').addEventListener('input', (e) => this.percorso.vaiA(e.target.value / 1000));
    $('#percorso-velocita').addEventListener('change', (e) => (this.percorso.velocita = +e.target.value));
    $('#percorso-quota').addEventListener('change', (e) => (this.percorso.quota = +e.target.value));
    $('#percorso-audio-salta').addEventListener('click', () => { this.percorso.player.pause(); this.percorso.riprendiDopoAudio(); });
    // selezione dei modelli 3D con il clic
    let giu = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { giu = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!giu || Math.hypot(e.clientX - giu[0], e.clientY - giu[1]) > 6) return;
      const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(m, this.camera);
      const hit = this.raycaster.intersectObjects(this.modelli.oggetti(), true)[0];
      if (hit) { let o = hit.object; while (o && !o.userData.poi) o = o.parent; if (o) this.apriPoi(o.userData.poi); }
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.chiudiDettaglio(); this.chiudiPannello(); } if (e.key === ' ' && this.modalita === 'percorso' && e.target === document.body) { e.preventDefault(); this.percorso.play(); } });
  }
  menuAttivo(az) { document.querySelectorAll('#menu button').forEach((b) => b.classList.toggle('attivo', b.dataset.azione === az)); }
  apriPannello(az) {
    this.pannelloAperto = az; this.menuAttivo(az);
    const corpo = $('#pannello-corpo'), titolo = $('#pannello-titolo');
    if (az === 'itinerari') { titolo.textContent = 'Itinerari'; this.renderItinerari(corpo); }
    else if (az === 'poi') { titolo.textContent = 'Punti di interesse'; this.pannelloPoi.render(corpo); }
    else if (az === 'foto360') { titolo.textContent = 'Foto 360'; this.foto.render(corpo); }
    else if (az === 'mappe') { titolo.textContent = 'Mappe sovrapponibili'; this.renderMappe(corpo); $('#btn-mappe').classList.add('attivo'); }
    $('#pannello').classList.remove('chiuso');
  }
  chiudiPannello() { this.pannelloAperto = null; $('#pannello').classList.add('chiuso'); $('#btn-mappe').classList.remove('attivo'); }
  apriPoi(p, vola = false) {
    this.pannelloPoi.renderDettaglio(p, $('#dettaglio-corpo'));
    $('#dettaglio').classList.remove('nascosto');
    if (vola || this.camera.isOrthographicCamera) this.volaA(p, p.modello ? 1400 : 2600);
  }
  chiudiDettaglio() { $('#dettaglio').classList.add('nascosto'); }
  mostraVista(apri) { $('#vista').classList.toggle('chiuso', !apri); $('#btn-vista').classList.toggle('attivo', apri); if (apri) this.chiudiDettaglio(); }

  renderItinerari(corpo) {
    corpo.innerHTML = '';
    const opz = document.createElement('div'); opz.className = 'riga-opz';
    opz.innerHTML = `<label><input type="checkbox" id="it-tutti" ${this.itinerari.mostraTutti ? 'checked' : ''}> Mostra tutti i tracciati sul plastico</label>`;
    opz.querySelector('input').addEventListener('change', (e) => { this.itinerari.mostraTutti = e.target.checked; this.itinerari.aggiornaVisibilita(); });
    corpo.appendChild(opz);
    if (!this.itinerari.lista.length) { corpo.insertAdjacentHTML('beforeend', '<p class="vuoto">Nessun itinerario.</p>'); return; }
    for (const it of this.itinerari.lista) {
      const b = document.createElement('button'); b.className = 'voce' + (this.itinerari.selezionato === it.id ? ' attiva' : '');
      b.innerHTML = `<span class="colore" style="background:${esc(it.colore)}"></span><span class="testo"><b>${esc(it.nome)}</b><small>${esc(it.sottotitolo || it.descrizione || '')}</small></span><span class="badge">${it.km ? it.km + ' km' : ''}</span>`;
      b.addEventListener('click', () => this.selezionaItinerario(it, corpo));
      corpo.appendChild(b);
    }
  }
  selezionaItinerario(it, corpo) {
    this.esciPercorso(false);
    const v = this.itinerari.seleziona(it.id);
    this.etichette.impostaVisibiliAudio(it.id);
    corpo.querySelectorAll('.voce').forEach((x) => x.classList.toggle('attiva', x.querySelector('b')?.textContent === it.nome));
    const box = this.itinerari.box(it.id); if (box) this.inquadraBox(box);
    // azioni sotto l'elenco
    corpo.querySelector('.azioni')?.remove();
    const az = document.createElement('div'); az.className = 'azioni';
    az.innerHTML = `<div style="flex:1;font-size:13px;color:#3d3b35;padding:4px 2px">${esc(it.descrizione || '')}${it.audio?.length ? `<br><small>${it.audio.length} audio geolocalizzat${it.audio.length === 1 ? 'o' : 'i'} lungo il percorso</small>` : ''}</div>
      <button class="bottone primario" id="it-anima"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>Percorso animato</button>`;
    az.querySelector('#it-anima').addEventListener('click', () => this.avviaPercorso(it));
    const voce = [...corpo.querySelectorAll('.voce')].find((x) => x.classList.contains('attiva'));
    (voce || corpo).after ? voce.after(az) : corpo.appendChild(az);
    if (!v) return;
  }
  /** Percorso animato: camera a bassa quota allineata con l'itinerario, tasto play */
  avviaPercorso(it) {
    this.chiudiPannello(); this.chiudiDettaglio();
    this.modalita = 'percorso'; this.menuAttivo(null);
    this.itinerari.seleziona(it.id); this.etichette.impostaVisibiliAudio(it.id);
    this.camera = this.camProsp; this.controls.object = this.camProsp; this.controls.enabled = false;
    $('#btn-proiezione').classList.remove('attivo'); $('#btn-proiezione').classList.add('spento');
    this.percorso.velocita = +$('#percorso-velocita').value; this.percorso.quota = +$('#percorso-quota').value;
    this.percorso.avvia(it);
    $('#percorso').classList.remove('nascosto');
  }
  esciPercorso(resetSelezione = true) {
    if (this.modalita !== 'percorso') return;
    this.percorso.ferma();
    $('#percorso').classList.add('nascosto'); $('#btn-proiezione').classList.remove('spento');
    this.controls.enabled = true;
    this.controls.target.copy(this.percorso.mira); this.controls.update();
    this.modalita = 'libera';
    if (resetSelezione) { this.itinerari.seleziona(null); this.etichette.impostaVisibiliAudio(null); }
  }

  renderMappe(corpo) {
    const mappe = this.cfg.mappe || [];
    corpo.innerHTML = '<h3>Mappa principale</h3>' + mappe.map((m) => `<label class="riga-opz"><span>${esc(m.nome)}</span><input type="radio" name="mappa" value="${esc(m.id)}" ${this.terreno.mappaAttiva === m.id ? 'checked' : ''}></label>`).join('') +
      '<h3>Mappa sovrapposta</h3><label class="riga-opz"><span>Mappa</span><select id="sovra"><option value="">nessuna</option>' + mappe.map((m) => `<option value="${esc(m.id)}" ${this.terreno.sovraAttiva === m.id ? 'selected' : ''}>${esc(m.nome)}</option>`).join('') + '</select></label>' +
      `<label class="riga-opz"><span>Opacità</span><input type="range" id="sovra-op" min="0" max="1" step="0.05" value="${this.terreno.materialeSovra.opacity || 0.6}"></label>` +
      '<h3>Plastico</h3>' +
      `<label class="riga-opz"><span>Mostra tutte le scritte</span><input type="checkbox" id="tutte" ${this.etichette.mostraTutte ? 'checked' : ''}></label>` +
      '<p class="vuoto">Esagerazione del rilievo, luci, effetti e inquadratura si regolano nel pannello Visualizzazione (icona dei cursori in alto a destra).</p>' +
      '<h3>Fonti</h3>' + mappe.filter((m) => m.attribuzione).map((m) => `<p class="vuoto"><b>${esc(m.nome)}</b>: ${esc(m.attribuzione)}${m.fonte ? ` · <a href="${esc(m.fonte)}" target="_blank" rel="noopener">fonte</a>` : ''}</p>`).join('') +
      '<p class="vuoto">Rilievo: Mapzen/AWS Terrain Tiles (SRTM, EU-DEM). Tracciati su strada: OSRM su dati OpenStreetMap.</p>';
    corpo.querySelectorAll('input[name=mappa]').forEach((r) => r.addEventListener('change', () => { const m = mappe.find((x) => x.id === r.value); this.terreno.impostaMappa(m.id, m.file); }));
    corpo.querySelector('#sovra').addEventListener('change', (e) => { const m = mappe.find((x) => x.id === e.target.value); this.terreno.impostaSovrapposta(m?.id, m?.file, +corpo.querySelector('#sovra-op').value); });
    corpo.querySelector('#sovra-op').addEventListener('input', (e) => this.terreno.opacitaSovrapposta(+e.target.value));
    corpo.querySelector('#tutte').addEventListener('change', (e) => (this.etichette.mostraTutte = e.target.checked));
  }
  impostaEsagerazione(e) {
    this.terreno.impostaEsagerazione(e);
    for (const v of this.etichette.voci) { const d = v.userData.dato; v.position.copy(this.terreno.posizione(d.lon, d.lat, v.userData.tipo === 'audio' ? 14 : v.userData.tipo === 'foto360' ? (d.tipo === 'aerea' ? 120 : 10) : d.modello ? 24 : 6)); }
    for (const p of this.modelli.voci) p.position.copy(this.terreno.posizione(p.userData.poi.lon, p.userData.poi.lat));
    this.itinerari.gruppo.clear(); this.itinerari.linee.clear(); this.itinerari.carica(this.itinerariDati);
    const yb = this.terreno.base * this.terreno.esagerazione - this.geo.larghezza * 0.012 * 0.6 - 2;
    this.ambiente.tavolo.position.y = yb; this.ambiente.ombraContatto.position.y = yb + 1.5;
  }

  ridimensiona() {
    const asp = innerWidth / innerHeight;
    this.camProsp.aspect = asp; this.camProsp.updateProjectionMatrix();
    const h = this.camOrto.top; this.camOrto.left = -h * asp; this.camOrto.right = h * asp; this.camOrto.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.post.setSize(innerWidth, innerHeight); this.etichette.ridimensiona(); this.itinerari.ridimensiona();
  }
  anima() {
    requestAnimationFrame(() => this.anima());
    const dt = Math.min(0.1, this.orologio.getDelta());
    if (this.volo) this.volo(performance.now());
    if (this.modalita === 'percorso') this.percorso.aggiorna(dt); else this.controls.update();
    const dist = this.modalita === 'percorso' ? 1500 : this.distanzaEquivalente();
    this.etichette.aggiorna(dist, this.modalita, this.camera);
    this.modelli.aggiorna(this.modalita === 'percorso' ? 0 : dist);
    this.ambiente.aggiorna(this.orologio.elapsedTime); this.terreno.aggiorna(this.orologio.elapsedTime);
    { const [u, v] = this.puntoOsservato(); this.dettaglio.aggiorna(u, v, dist); }
    if (this.vista.valori.effetti) this.post.render(this.scena, this.camera, 0.5, this.modalita === 'percorso' ? 0 : 1);
    else this.renderer.render(this.scena, this.camera);
    this.etichette.render(this.scena, this.camera);
  }
}

new App().avvia().catch((e) => { console.error(e); $('#caricamento-testo').textContent = 'Errore: ' + e.message; });
