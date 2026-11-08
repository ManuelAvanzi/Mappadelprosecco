// Dettaglio a bassa quota: tasselli ad alta risoluzione (data/dettaglio/, generati da build-data --solo=dettaglio) caricati
// solo intorno al punto che la camera guarda, quando la camera è bassa, e fusi sulla mappa di base dallo shader del terreno.
// Tiene al massimo 4 tasselli attivi (il blocco 2×2 più vicino al punto osservato) e una piccola cache di quelli già scaricati.
import * as THREE from 'three';

const SLOT = 4;          // tasselli contemporanei nello shader
const CACHE_MAX = 8;     // texture tenute in memoria
const DIST_PIENO = 5000; // distanza equivalente (m) sotto cui il dettaglio è al 100 %
const DIST_ZERO = 9000;  // sopra questa distanza il dettaglio è spento e i tasselli non vengono richiesti

export class Dettaglio {
  constructor(terreno, cfg) {
    this.terreno = terreno; this.cfg = cfg.dettaglio || null;
    this.voluto = true; this.supportato = true;
    this.cache = new Map(); // "x-y" → { colore, maschera, pronto, ultimoUso }
    this.loader = new THREE.TextureLoader();
    this.aniso = 1;
    this.correnti = [];
  }
  /** i tasselli esistono (config.dettaglio scritto da build-data --solo=dettaglio) */
  get disponibile() { return !!this.cfg; }
  get attivo() { return this.voluto && this.supportato && !!this.cfg; }
  abilita(on) { this.voluto = !!on; }
  impostaRenderer(renderer) {
    this.aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    this.supportato = renderer.capabilities.maxTextureSize >= (this.cfg?.larghezza || 4096);
  }
  /** chiave e rettangolo UV (u0, v0, du, dv) del tassello (tx, ty) */
  rett(tx, ty) { const G = this.cfg.griglia; return new THREE.Vector4(tx / G, 1 - (ty + 1) / G, 1 / G, 1 / G); } // v di three cresce verso nord
  carica(tx, ty) {
    const k = `${tx}-${ty}`;
    let v = this.cache.get(k);
    if (v) { v.ultimoUso = performance.now(); return v; }
    v = { tx, ty, colore: null, maschera: null, pronto: false, ultimoUso: performance.now() };
    this.cache.set(k, v);
    const dir = `data/${this.cfg.cartella}/`;
    let n = 0; const fatto = () => { if (++n === 2) v.pronto = true; };
    this.loader.load(`${dir}colori-${tx}-${ty}.jpg`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; v.colore = t; fatto(); }, undefined, () => { v.errore = true; });
    this.loader.load(`${dir}maschera-${tx}-${ty}.png`, (t) => { t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; v.maschera = t; fatto(); }, undefined, () => { v.errore = true; });
    // sfoltisce la cache
    if (this.cache.size > CACHE_MAX) {
      const vecchi = [...this.cache.values()].filter((c) => !this.correnti.includes(c)).sort((a, b) => a.ultimoUso - b.ultimoUso);
      while (this.cache.size > CACHE_MAX && vecchi.length) { const c = vecchi.shift(); c.colore?.dispose(); c.maschera?.dispose(); this.cache.delete(`${c.tx}-${c.ty}`); }
    }
    return v;
  }
  /**
   * @param {number} u  coordinata u (0..1, verso est) del punto osservato
   * @param {number} v  coordinata v (0..1, verso sud) del punto osservato
   * @param {number} dist distanza equivalente della camera (m)
   */
  aggiorna(u, v, dist) {
    const U = this.terreno.uniformi; if (!U?.uDettMix) return;
    // i tasselli ridisegnano la mappa dei colori: con un'altra mappa principale (stradale, satellite…) non vanno sovrapposti
    const mix = this.attivo && this.terreno.mappaAttiva === 'colori' ? 1 - THREE.MathUtils.smoothstep(dist, DIST_PIENO, DIST_ZERO) : 0;
    if (mix <= 0.001) { this.livello = 0; U.uDettMix.value = 0; return; }
    const G = this.cfg.griglia;
    // blocco 2×2 di tasselli più vicino al punto osservato: il tassello che lo contiene più il vicino dal lato più prossimo
    const gu = THREE.MathUtils.clamp(u, 0, 0.9999) * G, gv = THREE.MathUtils.clamp(v, 0, 0.9999) * G;
    const ix = Math.floor(gu), iy = Math.floor(gv);
    const x0 = THREE.MathUtils.clamp(gu - ix < 0.5 ? ix - 1 : ix, 0, G - 2), y0 = THREE.MathUtils.clamp(gv - iy < 0.5 ? iy - 1 : iy, 0, G - 2);
    const voluti = [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]].map(([x, y]) => this.carica(x, y));
    this.correnti = voluti;
    let pronti = 0;
    for (let i = 0; i < SLOT; i++) {
      const t = voluti[i];
      if (t?.pronto) { U[`tD${i}`].value = t.colore; U[`tM${i}`].value = t.maschera; U[`uDR${i}`].value.copy(this.rett(t.tx, t.ty)); pronti++; }
      else U[`uDR${i}`].value.set(0, 0, 0, 0);
    }
    // finché i tasselli non sono pronti il dettaglio resta a zero, poi sale dolcemente
    this.livello = THREE.MathUtils.lerp(this.livello || 0, pronti ? mix : 0, 0.08);
    U.uDettMix.value = this.livello;
  }
}
