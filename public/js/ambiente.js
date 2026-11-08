// L'ambiente attorno al plastico: il tavolo su cui appoggia, il fondale (studio o cielo con sole e nuvole),
// la luce del sole secondo l'ora del giorno, le ombre e l'ombra di contatto sotto il basamento.
import * as THREE from 'three';

const DOME_VERT = `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DOME_FRAG = `
  uniform vec3 uTop, uBottom, uSun, uSunColor; uniform float uMode, uTime, uClouds; varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir); float e = d.y;
    vec3 c = mix(uBottom, uTop, smoothstep(-0.02, 0.6, e));
    if (uMode > 0.5) {
      float cs = dot(d, uSun);
      float disc = smoothstep(0.9985, 0.9995, cs);
      float halo = pow(max(cs, 0.0), 10.0) * 0.35 + pow(max(cs, 0.0), 2.0) * 0.08;
      c += uSunColor * (disc * 3.0 + halo);
      if (e > 0.0 && uClouds > 0.001) {
        vec2 uv = d.xz / (e + 0.25) * 1.4 + uTime * 0.003;
        float n = fbm(uv * 1.2);
        float cov = smoothstep(0.62 - 0.32 * uClouds, 0.8 - 0.2 * uClouds, n) * smoothstep(0.0, 0.12, e);
        vec3 cloud = mix(vec3(1.0), uSunColor * 0.9 + 0.1, 0.5);
        c = mix(c, mix(cloud, uBottom * 0.8, 0.25), cov * 0.9);
      }
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

const TAVOLI = {
  legno: { colore: 0xa8865a, rug: 0.75 },
  noce: { colore: 0x6b4a30, rug: 0.7 },
  feltro: { colore: 0x3f6b43, rug: 1 },
  grigio: { colore: 0xb9bcc2, rug: 0.9 },
  carta: { colore: 0xf4f0e6, rug: 0.95, griglia: true },
  nero: { colore: 0x1e1f23, rug: 0.8 },
};
export const OPZIONI = { fondale: ['studio', 'cielo'], tavolo: Object.keys(TAVOLI) };

export class Ambiente {
  constructor(scena, renderer, terreno, geo) {
    this.scena = scena; this.renderer = renderer; this.terreno = terreno; this.geo = geo;
    const L = geo.larghezza;
    // fondale
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(L * 4.5, 48, 24), new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uMode: { value: 1 }, uTime: { value: 0 }, uClouds: { value: 0.3 } },
    }));
    this.dome.name = 'fondale'; this.dome.renderOrder = -10; scena.add(this.dome);
    scena.background = null;
    scena.fog = new THREE.Fog(0xdfe8ee, L * 1.2, L * 4.2);
    // tavolo
    const yb = terreno.base * terreno.esagerazione - L * 0.012 * 0.6 - 2;
    this.yTavolo = yb;
    this.tavolo = new THREE.Mesh(new THREE.PlaneGeometry(L * 9, L * 9), new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 0.75 }));
    this.tavolo.rotateX(-Math.PI / 2); this.tavolo.position.y = yb; this.tavolo.receiveShadow = true; this.tavolo.name = 'tavolo';
    scena.add(this.tavolo);
    // ombra di contatto: sfumatura scura attorno al basamento
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 60, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const tOmbra = new THREE.CanvasTexture(cv);
    this.ombraContatto = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.35, geo.altezza * 1.5), new THREE.MeshBasicMaterial({ map: tOmbra, transparent: true, depthWrite: false }));
    this.ombraContatto.rotateX(-Math.PI / 2); this.ombraContatto.position.y = yb + 1.5; this.ombraContatto.renderOrder = -5; scena.add(this.ombraContatto);
    // luci
    this.hemi = new THREE.HemisphereLight(0xdfe9f3, 0x8a7a5a, 0.9); scena.add(this.hemi);
    this.sole = new THREE.DirectionalLight(0xfff2dc, 2.1); scena.add(this.sole); scena.add(this.sole.target);
    this.sole.castShadow = true; this.sole.shadow.mapSize.set(2048, 2048);
    const sc = this.sole.shadow.camera; sc.left = -L * 0.56; sc.right = L * 0.56; sc.top = geo.altezza * 0.6; sc.bottom = -geo.altezza * 0.6; sc.near = L * 0.2; sc.far = L * 2.6;
    this.sole.shadow.bias = -0.0004; this.sole.shadow.normalBias = 18; this.sole.shadow.radius = 2;
    this.riempi = new THREE.DirectionalLight(0xcfe0ff, 0.5); this.riempi.position.set(L * 0.5, L * 0.3, -geo.altezza); scena.add(this.riempi);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.texTavolo = null;
  }
  grigliaTavolo() {
    if (this.texTavolo) return this.texTavolo;
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, S, S);
    for (let i = 0; i <= 10; i++) { const p = (i * S) / 10; g.strokeStyle = i % 10 === 0 ? 'rgba(90,80,60,0.4)' : 'rgba(90,80,60,0.14)'; g.lineWidth = i % 10 === 0 ? 3 : 1.5; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.moveTo(0, p); g.lineTo(S, p); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    this.texTavolo = t; return t;
  }
  /** applica le impostazioni di vista (fondale, tavolo, ora, sole, ambiente, nuvole, ombre) */
  applica(v) {
    const L = this.geo.larghezza;
    // tavolo
    const tv = TAVOLI[v.tavolo] || TAVOLI.legno;
    this.tavolo.material.color.set(tv.colore); this.tavolo.material.roughness = tv.rug;
    this.tavolo.material.map = tv.griglia ? this.grigliaTavolo() : null; this.tavolo.material.needsUpdate = true;
    this.tavolo.visible = v.tavolo !== 'nessuno'; this.ombraContatto.visible = this.tavolo.visible;
    // sole: ora 5–21 → arco est-sud-ovest
    const t = Math.min(Math.max((v.ora - 5) / 16, 0.03), 0.97);
    const el = Math.sin(t * Math.PI) * THREE.MathUtils.degToRad(64) + THREE.MathUtils.degToRad(6);
    const az = THREE.MathUtils.degToRad(90 + t * 180); // da est (90°) verso ovest (270°), passando a sud (180°)
    // in scena: +x est, +z sud. Direzione del sole (verso cui guardare)
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sole.position.copy(dir).multiplyScalar(L * 1.4); this.sole.target.position.set(0, 0, 0);
    const caldo = 1 - Math.min(1, el / THREE.MathUtils.degToRad(35)); // basso sull'orizzonte = caldo
    const colSole = new THREE.Color().lerpColors(new THREE.Color(0xfff6e8), new THREE.Color(0xffa45c), caldo);
    this.sole.color.copy(colSole); this.sole.intensity = 2.1 * v.sole * (0.55 + 0.45 * Math.sin(el));
    this.sole.castShadow = !!v.ombre;
    this.hemi.intensity = 0.9 * v.ambiente; this.riempi.intensity = 0.5 * v.ambiente;
    // fondale
    const u = this.dome.material.uniforms;
    u.uMode.value = v.fondale === 'cielo' ? 1 : 0; u.uClouds.value = v.nuvole; u.uSun.value.copy(dir); u.uSunColor.value.copy(colSole);
    if (v.fondale === 'cielo') {
      u.uTop.value.lerpColors(new THREE.Color(0x7fb2e8), new THREE.Color(0x5a6aa8), caldo * 0.6);
      u.uBottom.value.lerpColors(new THREE.Color(0xe6eff6), new THREE.Color(0xf6c89a), caldo);
      this.hemi.color.lerpColors(new THREE.Color(0xdfe9f3), new THREE.Color(0xf7d6b8), caldo); this.hemi.groundColor.set(tv.colore).multiplyScalar(0.6);
    } else {
      u.uTop.value.set(v.studioAlto || 0xdfe3e8); u.uBottom.value.set(v.studioBasso || 0xf3f0ea);
      this.hemi.color.set(0xeef0f4); this.hemi.groundColor.set(tv.colore).multiplyScalar(0.7);
    }
    this.scena.fog.color.copy(u.uBottom.value);
    this.scena.fog.near = L * (0.6 + 1.4 * (v.nebbia ?? 0.5)); this.scena.fog.far = L * (2.2 + 3 * (v.nebbia ?? 0.5));
    this.renderer.toneMappingExposure = v.esposizione;
  }
  aggiorna(t) { this.dome.material.uniforms.uTime.value = t; }
}
