// Visore delle foto 360 (equirettangolari) a tutto schermo, con frecce per passare da una foto all'altra.
import * as THREE from 'three';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = (u) => (u && !/^https?:|^\//.test(u) ? '/' + u : u);

export class Foto360 {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('visore360');
    this.contenitore = document.getElementById('visore360-scena');
    this.titolo = document.getElementById('visore360-titolo');
    this.frecce = document.getElementById('visore360-frecce');
    document.getElementById('visore360-plastico').addEventListener('click', () => { this.chiudi(); app.vedutaAerea(); });
    this.scena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    this.renderer = null;
    this.sfera = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 40), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    this.sfera.geometry.scale(-1, 1, 1);
    this.scena.add(this.sfera);
    this.lon = 0; this.lat = 0; this.attivo = false;
    this.collegamenti = [];
    this.loader = new THREE.TextureLoader();
    this.eventi();
  }
  eventi() {
    let giu = false, px = 0, py = 0, lon0 = 0, lat0 = 0;
    const c = this.contenitore;
    c.addEventListener('pointerdown', (e) => { giu = true; px = e.clientX; py = e.clientY; lon0 = this.lon; lat0 = this.lat; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (!giu) return; this.lon = lon0 - (e.clientX - px) * 0.18; this.lat = Math.max(-85, Math.min(85, lat0 + (e.clientY - py) * 0.18)); });
    c.addEventListener('pointerup', () => { giu = false; });
    c.addEventListener('wheel', (e) => { this.camera.fov = Math.max(35, Math.min(100, this.camera.fov + e.deltaY * 0.04)); this.camera.updateProjectionMatrix(); }, { passive: true });
    addEventListener('keydown', (e) => { if (this.attivo && e.key === 'Escape') { this.chiudi(); } });
    addEventListener('resize', () => this.ridimensiona());
  }
  ridimensiona() {
    if (!this.renderer) return;
    this.renderer.setSize(this.contenitore.clientWidth, this.contenitore.clientHeight);
    this.camera.aspect = this.contenitore.clientWidth / this.contenitore.clientHeight; this.camera.updateProjectionMatrix();
  }
  /** elenco per il pannello */
  render(corpo) {
    const lista = this.app.foto360;
    corpo.innerHTML = '';
    if (!lista.length) { corpo.innerHTML = '<p class="vuoto">Nessuna foto 360 ancora caricata. Si aggiungono dal backend (menu Foto 360): foto aeree o a terra, con i collegamenti tra una foto e l’altra.</p>'; return; }
    for (const tipo of ['aerea', 'terra']) {
      const sub = lista.filter((f) => (f.tipo || 'terra') === tipo);
      if (!sub.length) continue;
      const h = document.createElement('h3'); h.textContent = tipo === 'aerea' ? 'Foto aeree' : 'Foto a terra'; corpo.appendChild(h);
      for (const f of sub) {
        const b = document.createElement('button'); b.className = 'voce';
        b.innerHTML = `<img class="copertina" loading="lazy" src="${esc(url(f.anteprima || f.url))}" alt=""><span class="testo"><b>${esc(f.titolo || 'Foto 360')}</b><small>${esc(f.descrizione || '')}</small></span>`;
        b.addEventListener('click', () => this.apri(f.id));
        corpo.appendChild(b);
      }
    }
  }
  apri(id) { const f = this.app.foto360.find((x) => x.id === id); if (f) this.mostra(f); }
  apriUrl(u, titolo) { this.mostra({ id: null, url: u, titolo, collegamenti: [] }); }
  mostra(f) {
    this.corrente = f;
    if (!this.renderer) { this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.contenitore.appendChild(this.renderer.domElement); }
    this.el.classList.remove('nascosto'); this.attivo = true; this.ridimensiona();
    this.titolo.textContent = f.titolo || 'Foto 360';
    this.lon = f.direzioneIniziale || 0; this.lat = 0; this.camera.fov = 75; this.camera.updateProjectionMatrix();
    this.sfera.material.map?.dispose();
    this.sfera.material = new THREE.MeshBasicMaterial({ color: 0x222222 });
    this.loader.load(url(f.url), (t) => { t.colorSpace = THREE.SRGBColorSpace; this.sfera.material = new THREE.MeshBasicMaterial({ map: t }); });
    // frecce verso le foto collegate
    this.frecce.innerHTML = ''; this.collegamenti = [];
    for (const c of f.collegamenti || []) {
      const dest = this.app.foto360.find((x) => x.id === c.a); if (!dest) continue;
      let dir = c.direzione;
      if (dir == null && dest.lat && f.lat) dir = (Math.atan2((dest.lon - f.lon) * Math.cos((f.lat * Math.PI) / 180), dest.lat - f.lat) * 180) / Math.PI;
      const b = document.createElement('button'); b.className = 'freccia360';
      b.innerHTML = `<span class="cerchio"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>${esc(dest.titolo || '')}</span>`;
      b.addEventListener('click', () => this.mostra(dest));
      this.frecce.appendChild(b);
      this.collegamenti.push({ el: b, dir: dir || 0, alt: c.altezza ?? -12 });
    }
    if (!this.loop) { this.loop = true; this.anima(); }
  }
  chiudi() { this.el.classList.add('nascosto'); this.attivo = false; }
  anima() {
    if (this.attivo) {
      const phi = THREE.MathUtils.degToRad(90 - this.lat), theta = THREE.MathUtils.degToRad(this.lon);
      // direzione 0° = nord = -Z; cresce in senso orario
      this.camera.lookAt(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));
      this.renderer.render(this.scena, this.camera);
      const w = this.contenitore.clientWidth, h = this.contenitore.clientHeight;
      for (const c of this.collegamenti) {
        const p2 = THREE.MathUtils.degToRad(90 - c.alt), t2 = THREE.MathUtils.degToRad(c.dir);
        const v = new THREE.Vector3(Math.sin(t2) * Math.sin(p2), Math.cos(p2), -Math.cos(t2) * Math.sin(p2)).multiplyScalar(10).project(this.camera);
        const dietro = v.z > 1;
        c.el.style.display = dietro || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15 ? 'none' : 'flex';
        c.el.style.left = ((v.x + 1) / 2) * w + 'px'; c.el.style.top = ((1 - v.y) / 2) * h + 'px';
      }
    }
    requestAnimationFrame(() => this.anima());
  }
}
