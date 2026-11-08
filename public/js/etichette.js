// Punti e scritte dei luoghi (CSS2D) con apparizione progressiva per livello ("scale importance code").
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export class Etichette {
  constructor(scena, terreno, cfg, contenitore) {
    this.scena = scena; this.terreno = terreno; this.cfg = cfg;
    this.renderer = new CSS2DRenderer({ element: contenitore });
    this.renderer.setSize(innerWidth, innerHeight);
    this.gruppo = new THREE.Group(); this.gruppo.name = 'etichette';
    scena.add(this.gruppo);
    this.voci = [];
    this.onClick = () => {};
    this.livelloCorrente = 1;
    this.mostraTutte = false;
  }
  svuota(tipo) {
    for (const v of [...this.voci]) if (!tipo || v.userData.tipo === tipo) { this.gruppo.remove(v); v.element.remove(); this.voci.splice(this.voci.indexOf(v), 1); }
  }
  /** aggiunge l'etichetta di un punto di interesse */
  aggiungiPoi(poi) {
    if (poi.visibile === false) return null;
    const el = document.createElement('div');
    el.className = `etichetta liv${poi.livello || 3}` + (poi.modello ? ' monumento' : '');
    el.innerHTML = `<span class="punto"></span><span class="nome">${escape(poi.nome)}</span>`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onClick(poi, 'poi'); });
    const sopra = poi.modello ? 24 : 6;
    const o = new CSS2DObject(el);
    o.position.copy(this.terreno.posizione(poi.lon, poi.lat, sopra));
    o.userData = { tipo: 'poi', livello: poi.livello || 3, dato: poi };
    this.gruppo.add(o); this.voci.push(o);
    return o;
  }
  /** marcatore di una foto 360 (icona separata) */
  aggiungiFoto360(f) {
    const el = document.createElement('div');
    el.className = 'etichetta foto360';
    el.innerHTML = `<span class="punto"></span><span class="nome">${escape(f.titolo || 'Foto 360')}</span>`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onClick(f, 'foto360'); });
    const o = new CSS2DObject(el);
    o.position.copy(this.terreno.posizione(f.lon, f.lat, f.tipo === 'aerea' ? 120 : 10));
    o.userData = { tipo: 'foto360', livello: f.livello || 2, dato: f };
    this.gruppo.add(o); this.voci.push(o);
    return o;
  }
  /** marcatore di un audio geolocalizzato lungo un itinerario */
  aggiungiAudio(a, itinerario) {
    const el = document.createElement('div');
    el.className = 'etichetta audio';
    el.title = a.titolo || 'Audio';
    el.innerHTML = `<span class="punto"></span><span class="nome">${escape(a.titolo || '')}</span>`;
    const o = new CSS2DObject(el);
    o.position.copy(this.terreno.posizione(a.lon, a.lat, 14));
    o.userData = { tipo: 'audio', livello: 1, dato: a, itinerario };
    this.gruppo.add(o); this.voci.push(o);
    return o;
  }
  impostaVisibiliAudio(itinerarioId) {
    for (const v of this.voci) if (v.userData.tipo === 'audio') v.userData.soloPer = itinerarioId;
  }
  /** livello visibile in funzione della distanza equivalente della camera (m) */
  livelloPer(dist) {
    const L = this.cfg.livelli || {};
    if (dist < (L[3] ?? 11000)) return 3;
    if (dist < (L[2] ?? 26000)) return 2;
    return 1;
  }
  aggiorna(dist, modalita, camera) {
    const liv = this.mostraTutte ? 3 : this.livelloPer(dist);
    this.livelloCorrente = liv;
    for (const v of this.voci) {
      let vis = v.userData.livello <= liv;
      if (v.userData.tipo === 'audio') vis = v.userData.soloPer && v.userData.soloPer === v.userData.itinerario;
      if (modalita === 'percorso' && v.userData.tipo === 'poi' && v.userData.livello > 2) vis = false;
      v.userData.vis = vis;
    }
    // anti-sovrapposizione: le scritte più importanti (livello basso, città prima dei monumenti) vincono sulle altre
    if (camera && (this.contatore = (this.contatore || 0) + 1) % 6 === 0) this.evitaSovrapposizioni(camera);
    for (const v of this.voci) v.element.classList.toggle('nascosta', !(v.userData.vis && !v.userData.coperta));
  }
  evitaSovrapposizioni(camera) {
    const W = innerWidth, H = innerHeight, occupati = [];
    const prio = (v) => v.userData.livello * 10 + (v.userData.tipo === 'poi' && v.userData.dato.modello ? 3 : v.userData.tipo === 'foto360' ? 5 : v.userData.tipo === 'audio' ? -9 : 0);
    const vis = this.voci.filter((v) => v.userData.vis).sort((a, b) => prio(a) - prio(b));
    const p = new THREE.Vector3();
    for (const v of vis) {
      v.userData.coperta = false;
      if (v.userData.tipo === 'audio') continue;
      p.copy(v.position).project(camera);
      if (p.z > 1) { v.userData.coperta = true; continue; }
      const x = ((p.x + 1) / 2) * W, y = ((1 - p.y) / 2) * H;
      const w = (v.element.offsetWidth || 80) + 6, h = (v.element.offsetHeight || 16) + 4;
      const r = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      if (occupati.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) { v.userData.coperta = true; continue; }
      occupati.push(r);
    }
  }
  render(scena, camera) { this.renderer.render(scena, camera); }
  ridimensiona() { this.renderer.setSize(innerWidth, innerHeight); }
}

function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
