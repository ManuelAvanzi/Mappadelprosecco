// Itinerari in vettoriale sul plastico, elenco, percorso animato a bassa quota e audio geolocalizzati.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { distanzaM } from './geo.js';

const QUOTA_LINEA = 24; // m sopra il terreno (unità scena): abbastanza da non affiorare tra i vertici del plastico

export class Itinerari {
  constructor(scena, terreno, geo, cfg) {
    this.scena = scena; this.terreno = terreno; this.geo = geo; this.cfg = cfg;
    this.gruppo = new THREE.Group(); this.gruppo.name = 'itinerari';
    scena.add(this.gruppo);
    this.linee = new Map();
    this.selezionato = null;
    this.mostraTutti = false;
    this.risoluzione = new THREE.Vector2(innerWidth, innerHeight);
  }
  carica(lista) {
    this.lista = lista.filter((i) => i.visibile !== false && i.geometria?.length > 1);
    for (const it of this.lista) {
      const pts = this.campiona(it.geometria, 25);
      const pos = []; for (const p of pts) pos.push(p.x, p.y, p.z);
      const g = new LineGeometry(); g.setPositions(pos);
      const m = new LineMaterial({ color: new THREE.Color(it.colore || '#c62828'), linewidth: 3, worldUnits: false, transparent: true, opacity: 0.9, depthTest: true });
      m.resolution = this.risoluzione;
      const l = new Line2(g, m); l.computeLineDistances(); l.visible = false; l.userData.it = it;
      // alone bianco sotto
      const ma = new LineMaterial({ color: 0xffffff, linewidth: 6, worldUnits: false, transparent: true, opacity: 0.55 });
      ma.resolution = this.risoluzione;
      const alone = new Line2(g, ma); alone.visible = false;
      this.gruppo.add(alone); this.gruppo.add(l);
      this.linee.set(it.id, { linea: l, alone, punti: pts, it });
    }
    this.aggiornaVisibilita();
  }
  /** ricampiona la polilinea lon/lat ogni `passo` metri e la appoggia sul terreno */
  campiona(geom, passo) {
    const out = [];
    const pushP = (lon, lat) => out.push(this.terreno.posizione(lon, lat, QUOTA_LINEA));
    for (let i = 0; i + 1 < geom.length; i++) {
      const a = geom[i], b = geom[i + 1];
      const d = distanzaM(a, b), n = Math.max(1, Math.ceil(d / passo));
      for (let k = 0; k < n; k++) { const t = k / n; pushP(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); }
    }
    const z = geom[geom.length - 1]; pushP(z[0], z[1]);
    return out;
  }
  aggiornaVisibilita() {
    for (const [id, v] of this.linee) {
      const vis = this.mostraTutti || id === this.selezionato;
      v.linea.visible = vis; v.alone.visible = vis;
      const sel = id === this.selezionato;
      v.linea.material.linewidth = sel ? 4.5 : 3; v.linea.material.opacity = sel || !this.selezionato ? 0.95 : 0.45;
      v.alone.material.linewidth = sel ? 8 : 6;
    }
  }
  seleziona(id) { this.selezionato = id; this.aggiornaVisibilita(); return this.linee.get(id); }
  ridimensiona() { this.risoluzione.set(innerWidth, innerHeight); }
  /** riquadro 3D di un itinerario per inquadrarlo */
  box(id) { const v = this.linee.get(id); if (!v) return null; const b = new THREE.Box3(); for (const p of v.punti) b.expandByPoint(p); return b; }
}

/** Percorso animato: la camera segue l'itinerario a bassa quota; gli audio geolocalizzati fermano l'animazione. */
export class Percorso {
  constructor(terreno, geo, camera, ui) {
    this.terreno = terreno; this.geo = geo; this.camera = camera; this.ui = ui;
    this.attivo = false; this.inCorso = false; this.s = 0; this.velocita = 1; this.quota = 10;
    this.audioAscoltati = new Set(); this.audioInCorso = null;
    this.player = ui.audioPlayer;
    this.player.addEventListener('ended', () => this.riprendiDopoAudio());
    this.posCam = new THREE.Vector3(); this.mira = new THREE.Vector3();
  }
  avvia(it) {
    this.it = it;
    // percorso denso in coordinate geo + distanza progressiva
    const geom = it.geometria; const tratti = [0];
    for (let i = 1; i < geom.length; i++) tratti.push(tratti[i - 1] + distanzaM(geom[i - 1], geom[i]));
    this.geom = geom; this.tratti = tratti; this.lunghezza = tratti[tratti.length - 1];
    this.s = 0; this.attivo = true; this.inCorso = false; this.audioAscoltati.clear(); this.audioInCorso = null;
    this.ui.nome.textContent = it.nome; this.ui.km.textContent = (it.km ? it.km + ' km' : (this.lunghezza / 1000).toFixed(1) + ' km');
    this.ui.barra.value = 0; this.ui.play.classList.remove('in-corso'); this.ui.audio.classList.add('nascosto');
    this.posCam.copy(this.cameraPer(0, true)); this.mira.copy(this.puntoA(150));
    this.camera.position.copy(this.posCam); this.camera.lookAt(this.mira);
  }
  ferma() { this.attivo = false; this.inCorso = false; this.player.pause(); this.ui.audio.classList.add('nascosto'); }
  play(v) { this.inCorso = v ?? !this.inCorso; this.ui.play.classList.toggle('in-corso', this.inCorso); if (this.inCorso && this.audioInCorso) { this.player.pause(); this.audioInCorso = null; this.ui.audio.classList.add('nascosto'); } }
  vaiA(frazione) { this.s = frazione * this.lunghezza; this.posCam.copy(this.cameraPer(this.s, true)); }
  /** punto geo alla distanza s lungo il percorso */
  puntoGeo(s) {
    s = Math.min(Math.max(s, 0), this.lunghezza);
    let i = 1; while (i < this.tratti.length - 1 && this.tratti[i] < s) i++;
    const a = this.geom[i - 1], b = this.geom[i], L = this.tratti[i] - this.tratti[i - 1] || 1, t = (s - this.tratti[i - 1]) / L;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  /** punto scena a distanza s con quota di volo */
  puntoA(s, quotaExtra = 0) {
    const [lon, lat] = this.puntoGeo(s);
    return this.terreno.posizione(lon, lat, (this.quota + quotaExtra) * this.terreno.esagerazione);
  }
  /** camera arretrata di 70 m e più alta di 6 m rispetto al punto del percorso */
  cameraPer(s, iniziale = false) {
    const dietro = iniziale ? 110 : 70;
    const p = this.puntoA(Math.max(0, s - dietro), iniziale ? 14 : 6);
    // la camera non deve mai finire sotto il terreno: controlla la quota del suolo nel punto della camera
    const [lon, lat] = this.geo.aGeo(p.x, p.z);
    const suolo = this.terreno.quotaScena(lon, lat);
    if (p.y < suolo + 4 * this.terreno.esagerazione) p.y = suolo + 4 * this.terreno.esagerazione;
    return p;
  }
  aggiorna(dt) {
    if (!this.attivo) return;
    if (this.inCorso && !this.audioInCorso) {
      this.s += dt * 14 * this.velocita; // 14 m/s ≈ 50 km/h a velocità normale
      if (this.s >= this.lunghezza) { this.s = this.lunghezza; this.play(false); }
      this.ui.barra.value = Math.round((this.s / this.lunghezza) * 1000);
      this.controllaAudio();
    }
    const target = this.cameraPer(this.s);
    this.posCam.lerp(target, Math.min(1, dt * 2.5));
    this.mira.lerp(this.puntoA(this.s + 160), Math.min(1, dt * 3));
    this.camera.position.copy(this.posCam); this.camera.lookAt(this.mira);
  }
  controllaAudio() {
    const qui = this.puntoGeo(this.s);
    for (const a of this.it.audio || []) {
      if (!a.url || this.audioAscoltati.has(a)) continue;
      if (distanzaM(qui, [a.lon, a.lat]) <= (a.raggio || 150)) {
        this.audioAscoltati.add(a); this.audioInCorso = a;
        this.ui.audioTitolo.textContent = a.titolo || 'Audio';
        this.player.src = a.url.startsWith('/') ? a.url : '/' + a.url;
        this.ui.audio.classList.remove('nascosto');
        this.player.play().catch(() => {});
        break;
      }
    }
  }
  riprendiDopoAudio() { if (!this.audioInCorso) return; this.audioInCorso = null; this.ui.audio.classList.add('nascosto'); }
}
