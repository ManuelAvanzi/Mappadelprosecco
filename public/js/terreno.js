// Il plastico: terreno da data/altimetria.png (codifica terrarium), basamento, texture dei colori e mappe sovrapponibili.
import * as THREE from 'three';

export class Terreno {
  constructor(geo, cfg) {
    this.geo = geo; this.cfg = cfg;
    this.esagerazione = cfg.esagerazione || 1.7;
    this.gruppo = new THREE.Group();
    this.gruppo.name = 'plastico';
    this.quote = null; this.W = 0; this.H = 0;
    this.texture = new Map();
  }

  async carica(onProgress = () => {}) {
    onProgress('Lettura del rilievo…');
    const img = await caricaImmagine('data/' + (this.cfg.terreno?.file || 'altimetria.png'));
    this.W = img.naturalWidth; this.H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = this.W; cv.height = this.H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, this.W, this.H).data;
    const q = new Float32Array(this.W * this.H);
    let hmin = Infinity, hmax = -Infinity;
    for (let i = 0; i < this.W * this.H; i++) {
      const h = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      q[i] = h; if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    }
    this.quote = q; this.quotaMin = hmin; this.quotaMax = hmax;
    this.base = Math.floor(hmin / 50) * 50 - 60; // quota del basamento (m)

    onProgress('Modellazione delle colline…');
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 1);
    const segX = mobile ? 384 : 768;
    const segZ = Math.round(segX * this.geo.altezza / this.geo.larghezza);
    const geom = new THREE.PlaneGeometry(this.geo.larghezza, this.geo.altezza, segX, segZ);
    geom.rotateX(-Math.PI / 2); // piano XZ, normale +Y; dopo la rotazione v cresce verso sud (z+)
    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = 1 - uv.getY(i);
      pos.setY(i, this.quotaUV(u, v) * this.esagerazione);
      uv.setY(i, 1 - v); // texture con origine in alto a sinistra → three vuole v=1 in alto
    }
    geom.computeVertexNormals();
    this.materiale = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    this.vivacizza(this.materiale);
    this.mesh = new THREE.Mesh(geom, this.materiale);
    this.mesh.name = 'terreno';
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.gruppo.add(this.mesh);

    // mappa sovrapposta (trasparente) sulla stessa geometria
    this.materialeSovra = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    this.meshSovra = new THREE.Mesh(geom, this.materialeSovra);
    this.meshSovra.visible = false;
    this.gruppo.add(this.meshSovra);

    this.costruisciBasamento(geom, segX, segZ);
    onProgress('Colori della mappa…');
    const pred = (this.cfg.mappe || []).find((m) => m.predefinita) || { id: 'colori', file: 'data/colori.jpg' };
    await this.impostaMappa(pred.id, pred.file);
    return this;
  }

  /**
   * Acqua e vegetazione "vive": una maschera (R acqua, G vigneti, B boschi) ricavata dagli stessi vettori guida uno shader
   * che increspa e fa brillare l'acqua, screzia e riga i vigneti, chiazza e increspa i boschi. Tutto sfuma con la distanza
   * per non luccicare da lontano. Il cursore "Vivacità" regola l'insieme.
   */
  vivacizza(mat) {
    this.uniformi = {
      uTime: { value: 0 }, uViv: { value: 0.7 }, tMask: { value: null }, uHasMask: { value: 0 },
      // acqua: tinta (rgb lineare) + forza; proprietà: lucentezza, ampiezza onde, scala onde (m)
      uAcqua: { value: new THREE.Vector4(0.30, 0.55, 0.78, 0.45) }, uAcquaP: { value: new THREE.Vector4(0.88, 1, 38, 0) },
      // vigneti: tinta + forza; proprietà: screziatura, filari, passo dei filari (m)
      uVigne: { value: new THREE.Vector4(0.55, 0.62, 0.18, 0.3) }, uVigneP: { value: new THREE.Vector4(1, 1, 8, 0) },
      // boschi: tinta + forza; proprietà: chiazze, rilievo delle chiome, scala delle chiome (m)
      uBoschi: { value: new THREE.Vector4(0.08, 0.2, 0.05, 0.4) }, uBoschiP: { value: new THREE.Vector4(1, 1, 140, 0) },
      // dettaglio a bassa quota (dettaglio.js): fino a 4 tasselli colore + maschera, con il rettangolo UV che coprono (u0, v0, du, dv), e la fusione
      uDettMix: { value: 0 },
    };
    for (let i = 0; i < 4; i++) { this.uniformi[`tD${i}`] = { value: null }; this.uniformi[`tM${i}`] = { value: null }; this.uniformi[`uDR${i}`] = { value: new THREE.Vector4(0, 0, 0, 0) }; }
    this.fase = 0; this.velocitaOnde = 1; this.ultimoT = 0;
    new THREE.TextureLoader().load('data/' + (this.cfg.maschera?.file || 'maschera.png'), (t) => { t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; this.uniformi.tMask.value = t; this.uniformi.uHasMask.value = 1; }, undefined, () => {});
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniformi);
      sh.vertexShader = 'varying vec3 vPosW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `
        uniform float uTime, uViv, uHasMask; uniform sampler2D tMask; varying vec3 vPosW;
        uniform vec4 uAcqua, uAcquaP, uVigne, uVigneP, uBoschi, uBoschiP;
        uniform sampler2D tD0, tD1, tD2, tD3, tM0, tM1, tM2, tM3; uniform vec4 uDR0, uDR1, uDR2, uDR3; uniform float uDettMix;
        float hashv(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noisev(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hashv(i), hashv(i + vec2(1, 0)), f.x), mix(hashv(i + vec2(0, 1)), hashv(i + vec2(1, 1)), f.x), f.y); }
        bool dentroDett(vec4 r, vec2 uv, out vec2 t) { t = (uv - r.xy) / max(r.zw, vec2(1e-6)); return r.z > 0.0 && t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0; }
        vec3 vMaskVal;
      ` + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vMaskVal = vec3(0.0);
          #ifdef USE_MAP
          if (uHasMask > 0.5) vMaskVal = texture2D(tMask, vMapUv).rgb;
          if (uDettMix > 0.001) { // tassello ad alta risoluzione sotto la camera: sostituisce colore e maschera
            vec2 td; vec3 cd = vec3(0.0), md = vec3(0.0); bool okd = false;
            if (dentroDett(uDR0, vMapUv, td)) { cd = texture2D(tD0, td).rgb; md = texture2D(tM0, td).rgb; okd = true; }
            else if (dentroDett(uDR1, vMapUv, td)) { cd = texture2D(tD1, td).rgb; md = texture2D(tM1, td).rgb; okd = true; }
            else if (dentroDett(uDR2, vMapUv, td)) { cd = texture2D(tD2, td).rgb; md = texture2D(tM2, td).rgb; okd = true; }
            else if (dentroDett(uDR3, vMapUv, td)) { cd = texture2D(tD3, td).rgb; md = texture2D(tM3, td).rgb; okd = true; }
            if (okd) { diffuseColor.rgb = mix(diffuseColor.rgb, cd, uDettMix); vMaskVal = mix(vMaskVal, md, uDettMix); }
          }
          vMaskVal *= uViv;
          #endif
          float pxm = fwidth(vPosW.x) + 0.001; // metri per pixel sullo schermo
          if (vMaskVal.g > 0.01) { // vigneti: screziatura e filari (spariscono da lontano)
            float n = noisev(vPosW.xz / 180.0) - 0.5;
            float passo = max(uVigneP.z, 1.0);
            float fil = 0.5 + 0.5 * sin((vPosW.x * 0.86 + vPosW.z * 0.5) * 6.2832 / passo);
            float fade = smoothstep(passo * 1.8, passo * 0.4, pxm);
            diffuseColor.rgb *= 1.0 + vMaskVal.g * (0.22 * uVigneP.x * n * smoothstep(220.0, 40.0, pxm) + (fil - 0.5) * 0.18 * uVigneP.y * fade);
            diffuseColor.rgb = mix(diffuseColor.rgb, uVigne.rgb * (0.6 + 0.8 * dot(diffuseColor.rgb, vec3(0.33))), vMaskVal.g * uVigne.a);
          }
          if (vMaskVal.b > 0.01) { // boschi: chiazze di chiome
            vec2 qb = vPosW.xz / max(uBoschiP.z, 10.0);
            float n1 = noisev(qb / 3.0) - 0.5, n2 = noisev(qb * 1.3) - 0.5;
            diffuseColor.rgb *= 1.0 + vMaskVal.b * uBoschiP.x * (0.3 * n1 + 0.2 * n2 * smoothstep(160.0, 30.0, pxm));
            diffuseColor.rgb = mix(diffuseColor.rgb, uBoschi.rgb * (0.6 + 0.8 * dot(diffuseColor.rgb, vec3(0.33))), vMaskVal.b * uBoschi.a);
          }
          if (vMaskVal.r > 0.01) { // acqua: tinta propria
            diffuseColor.rgb = mix(diffuseColor.rgb, uAcqua.rgb, vMaskVal.r * uAcqua.a);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 1.0 - uAcquaP.x, vMaskVal.r);
          roughnessFactor = mix(roughnessFactor, 1.0, vMaskVal.b * 0.3);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          if (vMaskVal.r > 0.01 || vMaskVal.b > 0.01) {
            float pxn = fwidth(vPosW.x) + 0.001;
            vec3 pert = vec3(0.0);
            if (vMaskVal.r > 0.01 && uAcquaP.y > 0.001) { // increspature in movimento
              float sc = max(uAcquaP.z, 4.0);
              vec2 q = vPosW.xz / sc + vec2(uTime * 0.05, uTime * 0.035);
              float e = 0.35;
              float dx = noisev(q + vec2(e, 0.0)) - noisev(q - vec2(e, 0.0)), dz = noisev(q + vec2(0.0, e)) - noisev(q - vec2(0.0, e));
              pert += vec3(dx, 0.0, dz) * 0.9 * uAcquaP.y * vMaskVal.r * smoothstep(sc * 1.6, sc * 0.2, pxn);
            }
            if (vMaskVal.b > 0.01 && uBoschiP.y > 0.001) { // rilievo delle chiome
              vec2 q = vPosW.xz / max(uBoschiP.z, 10.0); float e = 0.3;
              float dx = noisev(q + vec2(e, 0.0)) - noisev(q - vec2(e, 0.0)), dz = noisev(q + vec2(0.0, e)) - noisev(q - vec2(0.0, e));
              pert += vec3(dx, 0.0, dz) * 0.7 * uBoschiP.y * vMaskVal.b * smoothstep(200.0, 25.0, pxn);
            }
            normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
          }`);
    };
    mat.customProgramCacheKey = () => 'terreno-vivo';
  }
  impostaVivacita(v) { this.uniformi.uViv.value = v; }
  /** tinte e proprietà di acqua, vigneti e boschi dai valori del pannello Visualizzazione (tinte in sRGB esadecimale) */
  impostaVegetazione(v) {
    const u = this.uniformi, c = new THREE.Color();
    const tinta = (vec, hex, forza) => { c.set(hex || '#ffffff'); vec.set(c.r, c.g, c.b, forza ?? vec.w); };
    tinta(u.uAcqua.value, v.acquaTinta, v.acquaForza);
    u.uAcquaP.value.set(v.acquaLucentezza ?? 0.88, v.acquaOnde ?? 1, v.acquaScala ?? 38, 0);
    this.velocitaOnde = v.acquaVelocita ?? 1;
    tinta(u.uVigne.value, v.vigneTinta, v.vigneForza);
    u.uVigneP.value.set(v.vigneScrezio ?? 1, v.vigneFilari ?? 1, v.vignePasso ?? 8, 0);
    tinta(u.uBoschi.value, v.boscoTinta, v.boscoForza);
    u.uBoschiP.value.set(v.boscoChiazze ?? 1, v.boscoRilievo ?? 1, v.boscoScala ?? 140, 0);
  }
  aggiorna(t) { this.fase += Math.max(0, t - this.ultimoT) * this.velocitaOnde; this.ultimoT = t; this.uniformi.uTime.value = this.fase; }

  /** quota (m, non esagerata) alle coordinate UV del riquadro, interpolazione bilineare */
  quotaUV(u, v) {
    const x = Math.min(Math.max(u * (this.W - 1), 0), this.W - 1.001), y = Math.min(Math.max(v * (this.H - 1), 0), this.H - 1.001);
    const i = Math.floor(x), j = Math.floor(y), ax = x - i, ay = y - j, q = this.quote, W = this.W;
    return q[j * W + i] * (1 - ax) * (1 - ay) + q[j * W + i + 1] * ax * (1 - ay) + q[(j + 1) * W + i] * (1 - ax) * ay + q[(j + 1) * W + i + 1] * ax * ay;
  }
  /** quota del plastico (già esagerata, in unità scena) in lon/lat */
  quotaScena(lon, lat) { const [u, v] = this.geo.aUV(lon, lat); return this.quotaUV(u, v) * this.esagerazione; }
  /** quota del plastico in coordinate locali x,z */
  quotaLocale(x, z) { const [lon, lat] = this.geo.aGeo(x, z); return this.quotaScena(lon, lat); }
  /** posizione 3D sul terreno con un'altezza aggiuntiva (metri di scena) */
  posizione(lon, lat, sopra = 0) { const [x, z] = this.geo.aLocale(lon, lat); return new THREE.Vector3(x, this.quotaScena(lon, lat) + sopra, z); }

  costruisciBasamento(geom, segX, segZ) {
    // pareti laterali dal bordo del terreno al basamento + fondo
    const pos = geom.attributes.position;
    const yb = this.base * this.esagerazione;
    const idx = (i, j) => j * (segX + 1) + i;
    const verts = [], indici = [];
    const bordo = [];
    for (let i = 0; i <= segX; i++) bordo.push(idx(i, 0));
    for (let j = 1; j <= segZ; j++) bordo.push(idx(segX, j));
    for (let i = segX - 1; i >= 0; i--) bordo.push(idx(i, segZ));
    for (let j = segZ - 1; j >= 1; j--) bordo.push(idx(0, j));
    for (let k = 0; k < bordo.length; k++) {
      const a = bordo[k], b = bordo[(k + 1) % bordo.length];
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a), bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
      const n = verts.length / 3;
      verts.push(ax, ay, az, bx, by, bz, bx, yb, bz, ax, yb, az);
      indici.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(indici); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xcdbb9a, roughness: 0.85 });
    const pareti = new THREE.Mesh(g, mat); pareti.name = 'basamento';
    this.gruppo.add(pareti);
    const fondo = new THREE.Mesh(new THREE.PlaneGeometry(this.geo.larghezza, this.geo.altezza), new THREE.MeshStandardMaterial({ color: 0xb9a683, roughness: 0.9 }));
    fondo.rotateX(Math.PI / 2); fondo.position.y = yb - 0.1;
    this.gruppo.add(fondo);
    // cornice sottile
    const spess = this.geo.larghezza * 0.012;
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(this.geo.larghezza + spess * 2, spess * 0.6, this.geo.altezza + spess * 2), new THREE.MeshStandardMaterial({ color: 0x8c7355, roughness: 0.7 }));
    cornice.position.y = yb - spess * 0.3; this.gruppo.add(cornice);
    this.cornice = cornice;
  }

  async texturaDi(id, file) {
    if (this.texture.has(id)) return this.texture.get(id);
    const t = await new THREE.TextureLoader().loadAsync(file);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    this.texture.set(id, t);
    return t;
  }
  /** mappa principale drappeggiata sul plastico */
  async impostaMappa(id, file) {
    const t = await this.texturaDi(id, file);
    this.materiale.map = t; this.materiale.needsUpdate = true; this.mappaAttiva = id;
  }
  /** mappa sovrapposta con opacità 0..1 (null per toglierla) */
  async impostaSovrapposta(id, file, opacita = 0.6) {
    if (!id) { this.meshSovra.visible = false; this.materialeSovra.opacity = 0; this.sovraAttiva = null; return; }
    const t = await this.texturaDi(id, file);
    this.materialeSovra.map = t; this.materialeSovra.opacity = opacita; this.materialeSovra.needsUpdate = true;
    this.meshSovra.visible = opacita > 0; this.sovraAttiva = id;
  }
  opacitaSovrapposta(o) { this.materialeSovra.opacity = o; this.meshSovra.visible = o > 0 && !!this.sovraAttiva; }

  /** cambia l'esagerazione verticale ricalcolando le quote dei vertici e il basamento */
  impostaEsagerazione(e) {
    const fattore = e / this.esagerazione; this.esagerazione = e;
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * fattore);
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals(); this.mesh.geometry.computeBoundingSphere();
    const segX = this.mesh.geometry.parameters.widthSegments, segZ = this.mesh.geometry.parameters.heightSegments;
    for (const o of [...this.gruppo.children]) if (o !== this.mesh && o !== this.meshSovra) { this.gruppo.remove(o); o.geometry.dispose(); }
    this.costruisciBasamento(this.mesh.geometry, segX, segZ);
  }
}

function caricaImmagine(url) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('immagine non caricata: ' + url)); i.src = url; });
}
