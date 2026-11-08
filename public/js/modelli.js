// Modelli 3D semplificati dei punti di interesse (procedurali per categoria, o GLB caricato) con scala che
// cresce con la distanza: da lontano sono molto grandi, avvicinandosi si riducono fino alla dimensione reale.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MAT = {
  pietra: new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.9 }),
  pietraScura: new THREE.MeshStandardMaterial({ color: 0xb9ad99, roughness: 0.9 }),
  tetto: new THREE.MeshStandardMaterial({ color: 0xb5553a, roughness: 0.8 }),
  intonaco: new THREE.MeshStandardMaterial({ color: 0xf1e3c4, roughness: 0.9 }),
  legno: new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 }),
  acqua: new THREE.MeshStandardMaterial({ color: 0x6fb3d6, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.9 }),
  roccia: new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 1 }),
  verde: new THREE.MeshStandardMaterial({ color: 0x5f8f4a, roughness: 0.95 }),
  bianco: new THREE.MeshStandardMaterial({ color: 0xfaf6ea, roughness: 0.8 }),
};
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); return o; };
const cil = (r, h, m, x = 0, y = 0, z = 0, seg = 16) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y + h / 2, z); return o; };
const cono = (r, h, m, x = 0, y = 0, z = 0, seg = 16) => { const o = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m); o.position.set(x, y + h / 2, z); return o; };
const tettoSpiovente = (w, h, d, m, x = 0, y = 0, z = 0, rotY = 0) => {
  // prisma triangolare lungo z
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    -w / 2, 0, -d / 2, w / 2, 0, -d / 2, 0, h, -d / 2, // retro
    -w / 2, 0, d / 2, w / 2, 0, d / 2, 0, h, d / 2,   // fronte
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = rotY; return o;
};

// Ogni costruttore restituisce un gruppo con base a y=0, centrato, dimensioni in metri reali (circa).
const COSTRUTTORI = {
  castello() {
    const g = new THREE.Group();
    g.add(box(60, 14, 44, MAT.pietra));
    for (const [x, z] of [[-30, -22], [30, -22], [-30, 22], [30, 22]]) { g.add(cil(7, 24, MAT.pietraScura, x, 0, z)); g.add(cono(8.5, 7, MAT.tetto, x, 24, z)); }
    g.add(box(18, 32, 18, MAT.pietraScura, 4, 0, -2)); g.add(cono(13, 10, MAT.tetto, 4, 32, -2, 4));
    for (let i = -24; i <= 24; i += 8) { g.add(box(4, 3, 3, MAT.pietra, i, 14, -22)); g.add(box(4, 3, 3, MAT.pietra, i, 14, 22)); }
    return { gruppo: g, dimensione: 70 };
  },
  abbazia() {
    const g = new THREE.Group();
    g.add(box(16, 14, 46, MAT.intonaco)); g.add(tettoSpiovente(18, 7, 48, MAT.tetto, 0, 14, 0));
    g.add(box(30, 9, 18, MAT.intonaco, 0, 0, -10)); g.add(tettoSpiovente(20, 5, 32, MAT.tetto, 0, 9, -10, Math.PI / 2));
    g.add(cil(6, 8, MAT.intonaco, 0, 0, 25, 12)); g.add(cono(6.5, 4, MAT.tetto, 0, 8, 25, 12));
    g.add(box(7, 34, 7, MAT.pietra, 13, 0, 14)); g.add(cono(5.5, 9, MAT.tetto, 13, 34, 14, 4));
    g.add(box(26, 6, 26, MAT.intonaco, -22, 0, 10)); // chiostro
    return { gruppo: g, dimensione: 60 };
  },
  chiesa() {
    const g = new THREE.Group();
    g.add(box(12, 10, 24, MAT.bianco)); g.add(tettoSpiovente(14, 5, 26, MAT.tetto, 0, 10, 0));
    g.add(cil(5, 7, MAT.bianco, 0, 0, 13, 12)); g.add(cono(5.5, 3, MAT.tetto, 0, 7, 13, 12));
    g.add(box(5, 26, 5, MAT.pietra, 9, 0, -8)); g.add(cono(4, 7, MAT.tetto, 9, 26, -8, 4));
    for (const x of [-9, -12, 10, 13]) g.add(cono(2.2, 14, MAT.verde, x, 0, 10 + x, 8)); // cipressi
    return { gruppo: g, dimensione: 32 };
  },
  pieve() {
    const g = new THREE.Group();
    g.add(box(14, 11, 30, MAT.intonaco)); g.add(tettoSpiovente(16, 5.5, 32, MAT.tetto, 0, 11, 0));
    g.add(box(22, 5, 8, MAT.intonaco, 0, 0, 18)); g.add(tettoSpiovente(24, 2.5, 9, MAT.tetto, 0, 5, 18, Math.PI / 2)); // portico
    for (let x = -8; x <= 8; x += 4) g.add(cil(0.6, 5, MAT.pietra, x, 0, 21.5, 8));
    g.add(cil(5.5, 8, MAT.intonaco, 0, 0, -17, 12)); g.add(cono(6, 3.5, MAT.tetto, 0, 8, -17, 12));
    g.add(box(6, 30, 6, MAT.pietra, 11, 0, -12)); g.add(cono(4.5, 8, MAT.tetto, 11, 30, -12, 4));
    return { gruppo: g, dimensione: 40 };
  },
  campanile() {
    const g = new THREE.Group();
    g.add(box(14, 10, 26, MAT.intonaco, 0, 0, 4)); g.add(tettoSpiovente(16, 5, 28, MAT.tetto, 0, 10, 4));
    g.add(box(7, 40, 7, MAT.pietra, 11, 0, -8)); g.add(box(8, 3, 8, MAT.pietraScura, 11, 36, -8)); g.add(cono(5.5, 10, MAT.tetto, 11, 40, -8, 4));
    return { gruppo: g, dimensione: 40 };
  },
  villa() {
    const g = new THREE.Group();
    g.add(box(34, 13, 16, MAT.intonaco)); g.add(tettoSpiovente(18, 4.5, 36, MAT.tetto, 0, 13, 0, Math.PI / 2));
    g.add(box(10, 4, 4, MAT.intonaco, 0, 13, 0)); // timpano
    g.add(box(14, 7, 12, MAT.intonaco, -26, 0, 2)); g.add(tettoSpiovente(14, 3, 16, MAT.tetto, -26, 7, 2, Math.PI / 2)); // barchesse
    g.add(box(14, 7, 12, MAT.intonaco, 26, 0, 2)); g.add(tettoSpiovente(14, 3, 16, MAT.tetto, 26, 7, 2, Math.PI / 2));
    for (const x of [-12, -6, 6, 12]) g.add(cono(3.5, 16, MAT.verde, x, 0, 22, 8)); // cedri
    return { gruppo: g, dimensione: 56 };
  },
  loggia() {
    const g = new THREE.Group();
    g.add(box(22, 5, 12, MAT.intonaco, 0, 0, 0)); // portico basso
    for (let x = -9; x <= 9; x += 4.5) g.add(cil(0.7, 5, MAT.pietra, x, 0, 6.5, 8));
    g.add(box(22, 7, 13, MAT.intonaco, 0, 5, 0)); g.add(tettoSpiovente(13, 3.5, 24, MAT.tetto, 0, 12, 0, Math.PI / 2));
    g.add(box(5, 24, 5, MAT.pietra, 14, 0, -5)); g.add(cono(3.8, 5, MAT.tetto, 14, 24, -5, 4));
    return { gruppo: g, dimensione: 30 };
  },
  mulino() {
    const g = new THREE.Group();
    g.add(box(10, 9, 8, MAT.pietraScura)); g.add(tettoSpiovente(11, 4, 9, MAT.tetto, 0, 9, 0, Math.PI / 2));
    g.add(box(6, 6, 5, MAT.legno, 7, 0, 0));
    const ruota = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.5, 8, 18), MAT.legno); ruota.position.set(-5.6, 3.6, 0); ruota.rotation.y = Math.PI / 2; g.add(ruota);
    for (let k = 0; k < 6; k++) { const r = box(0.4, 6.4, 0.6, MAT.legno, -5.6, 0.4, 0); r.rotation.x = (k * Math.PI) / 6; r.position.y = 3.6; r.geometry.translate(0, 0, 0); g.add(r); }
    g.add(box(30, 18, 10, MAT.roccia, 0, 0, -11)); // la croda
    const acqua = box(5, 0.4, 20, MAT.acqua, -9, 0, 2); g.add(acqua);
    return { gruppo: g, dimensione: 32 };
  },
  grotta() {
    const g = new THREE.Group();
    g.add(box(40, 22, 14, MAT.roccia, 0, 0, -10)); g.add(box(14, 22, 20, MAT.roccia, -20, 0, 0)); g.add(box(14, 22, 20, MAT.roccia, 20, 0, 0));
    const buco = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 14, 12, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2b2622 })); buco.position.set(0, 7, -3); g.add(buco);
    g.add(box(4, 0.4, 26, MAT.acqua, 0, 0, 4));
    const cascata = box(3, 18, 1, MAT.acqua, 0, 2, -3.5); g.add(cascata);
    return { gruppo: g, dimensione: 50 };
  },
  lago() {
    const g = new THREE.Group();
    const lago = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 1, 32), MAT.acqua); lago.scale.set(1.6, 1, 0.8); lago.position.y = 0.5; g.add(lago);
    for (const x of [-14, -6, 4, 14]) { g.add(cil(0.5, 5, MAT.legno, x, 0, 24, 6)); g.add(cil(0.5, 5, MAT.legno, x + 3, 0, 28, 6)); }
    g.add(box(26, 1, 8, MAT.legno, 2, 5, 26)); // palafitta
    g.add(box(8, 4, 6, MAT.legno, -4, 6, 26)); g.add(tettoSpiovente(9, 4, 7, new THREE.MeshStandardMaterial({ color: 0xa78a52 }), -4, 10, 26));
    g.add(box(8, 4, 6, MAT.legno, 8, 6, 26)); g.add(tettoSpiovente(9, 4, 7, new THREE.MeshStandardMaterial({ color: 0xa78a52 }), 8, 10, 26));
    return { gruppo: g, dimensione: 110 };
  },
};

const loader = new GLTFLoader();
async function caricaGLB(url) {
  const gltf = await loader.loadAsync(url);
  const sc = gltf.scene;
  sc.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (!o.material.map) { o.material = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.85 }); } } });
  // normalizza: base a y=0, centrato in xz, dimensione massima nota in metri
  const bb = new THREE.Box3().setFromObject(sc);
  const dim = new THREE.Vector3(); bb.getSize(dim);
  const centro = new THREE.Vector3(); bb.getCenter(centro);
  sc.position.sub(new THREE.Vector3(centro.x, bb.min.y, centro.z));
  const g = new THREE.Group(); g.add(sc);
  return { gruppo: g, dimensione: Math.max(dim.x, dim.z) };
}

export class Modelli {
  constructor(scena, terreno, cfg) {
    this.scena = scena; this.terreno = terreno; this.cfg = cfg;
    this.gruppo = new THREE.Group(); this.gruppo.name = 'modelli';
    scena.add(this.gruppo);
    this.voci = [];
  }
  async aggiungi(poi) {
    const m = poi.modello; if (!m) return null;
    let mod;
    if (m.glb) {
      try { mod = await caricaGLB(m.glb.startsWith('/') ? m.glb : '/' + m.glb); const target = m.dimensione || 40; mod.gruppo.scale.setScalar(target / mod.dimensione); mod.dimensione = target; }
      catch (e) { console.warn('GLB non caricato, uso il modello procedurale', m.glb, e); }
    }
    if (!mod) { const c = COSTRUTTORI[m.tipo] || COSTRUTTORI.chiesa; mod = c(); }
    const pivot = new THREE.Group();
    pivot.add(mod.gruppo);
    pivot.position.copy(this.terreno.posizione(poi.lon, poi.lat));
    pivot.rotation.y = ((m.rotazione || 0) * Math.PI) / 180;
    pivot.userData.poi = poi; pivot.userData.dimensione = mod.dimensione * (m.scala || 1);
    mod.gruppo.scale.multiplyScalar(m.scala || 1);
    mod.gruppo.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.poiId = poi.id; } });
    this.gruppo.add(pivot);
    this.voci.push(pivot);
    return pivot;
  }
  rimuovi(id) {
    const i = this.voci.findIndex((v) => v.userData.poi.id === id);
    if (i >= 0) { this.gruppo.remove(this.voci[i]); this.voci.splice(i, 1); }
  }
  /** chiamata a ogni frame: scala = max(1, distanzaEquivalente · fattore / dimensione) */
  aggiorna(distanzaEquivalente) {
    const f = this.cfg.modelli?.fattoreDistanza ?? 0.035;
    const smin = this.cfg.modelli?.scalaMinima ?? 1;
    for (const p of this.voci) {
      const s = Math.max(smin, (distanzaEquivalente * f) / p.userData.dimensione);
      p.scale.setScalar(s);
    }
  }
  oggetti() { return this.gruppo.children; }
}
