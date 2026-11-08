// Resa "da plastico" ed effetti di lente (dalla piazza 3D, adattato): la scena viene disegnata in una texture e poi
// lavorata a schermo intero: bagliore, sfocatura tilt-shift (miniatura), temperatura, contrasto, saturazione, grana, vignetta.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLUR_FN = `
  vec3 blurAt(sampler2D tex, vec2 uv, vec2 step, float r) {
    vec3 c = vec3(0.0); float ws = 0.0;
    for (int i = -6; i <= 6; i++) { float f = float(i), w = exp(-f * f / 14.0); c += texture2D(tex, uv + step * f * r).rgb * w; ws += w; }
    return c / ws;
  }`;
const TILT_FRAG = `
  uniform sampler2D tDiffuse; uniform vec2 uStep; uniform vec3 uFocus; varying vec2 vUv; ${BLUR_FN}
  void main() { float r = uFocus.z * smoothstep(uFocus.y, uFocus.y + 0.4, abs(vUv.y - uFocus.x)); gl_FragColor = vec4(blurAt(tDiffuse, vUv, uStep, r), 1.0); }`;
const BLUR_FRAG = `
  uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv; ${BLUR_FN}
  void main() { gl_FragColor = vec4(blurAt(tDiffuse, vUv, uStep, 1.0), 1.0); }`;
const BRIGHT_FRAG = `
  uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
  void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.7, l), 1.0); }`;
const FINAL_FRAG = `
  uniform sampler2D tDiffuse; uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform vec2 uStep; uniform vec3 uFocus; uniform vec2 uGrade; uniform vec4 uFx; uniform vec4 uFx2; uniform vec2 uRes; uniform float uTime;
  varying vec2 vUv; ${BLUR_FN}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float lumAt(vec2 uv) { return lum(texture2D(tScene, uv).rgb); }
  void main() {
    vec2 d = vUv - 0.5; vec2 uv = vUv;
    float band = uFocus.z * smoothstep(uFocus.y, uFocus.y + 0.4, abs(uv.y - uFocus.x));
    vec3 c = blurAt(tDiffuse, uv, uStep, band);
    c += texture2D(tBloom, uv).rgb * uFx.x * 0.8;
    if (uFx2.w > 0.001) {
      vec2 e = 1.2 / uRes;
      float tl = lumAt(uv + vec2(-e.x, e.y)), tc = lumAt(uv + vec2(0.0, e.y)), tr = lumAt(uv + e);
      float ml = lumAt(uv - vec2(e.x, 0.0)), mr = lumAt(uv + vec2(e.x, 0.0));
      float bl = lumAt(uv - e), bc = lumAt(uv - vec2(0.0, e.y)), br = lumAt(uv + vec2(e.x, -e.y));
      float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
      float edge = sqrt(gx * gx + gy * gy) / (lumAt(uv) + 0.25);
      c *= 1.0 - 0.85 * uFx2.w * (1.0 - band) * smoothstep(0.35, 1.2, edge);
    }
    float temp = uFx2.x;
    c *= vec3(1.0 + 0.18 * temp, 1.0 + 0.04 * temp, 1.0 - 0.18 * temp);
    c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uFx2.y));
    float l = lum(c); c = max(mix(vec3(l), c, uGrade.x), 0.0);
    if (uFx.y > 0.001) { float n = hash(floor(vUv * uRes * 0.5) + vec2(fract(uTime * 7.31), fract(uTime * 3.17)) * 100.0); c *= 1.0 + (n - 0.5) * 0.5 * uFx.y; }
    c *= 1.0 - uGrade.y * smoothstep(0.3, 0.95, length(d) * 1.35);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function creaPost(renderer) {
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const blurRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const bloomA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const bloomB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const look = { miniatura: 0.35, vignetta: 0.25, saturazione: 1.1, bagliore: 0.15, grana: 0, temperatura: 0, contrasto: 1.05, contorni: 0 };
  let width = 1, height = 1;
  const material = (frag, uniforms, final = false) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: final });
  const focus = new THREE.Vector3(0.5, 0.16, 1);
  const tilt = material(TILT_FRAG, { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() }, uFocus: { value: focus } });
  const bright = material(BRIGHT_FRAG, { tDiffuse: { value: null }, uThreshold: { value: 0.9 } });
  const blur = material(BLUR_FRAG, { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } });
  const final = material(FINAL_FRAG, { tDiffuse: { value: null }, tScene: { value: null }, tBloom: { value: null }, uStep: { value: new THREE.Vector2() }, uFocus: { value: focus },
    uGrade: { value: new THREE.Vector2() }, uFx: { value: new THREE.Vector4() }, uFx2: { value: new THREE.Vector4() }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } }, true);
  const U = final.uniforms;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tilt); quad.frustumCulled = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (mat, input, target) => { quad.material = mat; mat.uniforms.tDiffuse.value = input; renderer.setRenderTarget(target); renderer.render(quad, quadCam); };
  const applica = () => {
    const radius = height * 0.0175 * look.miniatura;
    tilt.uniforms.uStep.value.set(radius / 6 / width, 0); U.uStep.value.set(0, radius / 6 / height);
    focus.y = 0.26 - 0.16 * look.miniatura;
    U.uGrade.value.set(look.saturazione, look.vignetta);
    U.uFx.value.set(look.bagliore, look.grana, 0, 0);
    U.uFx2.value.set(look.temperatura, look.contrasto, 0, look.contorni);
  };
  return {
    look,
    setSize(w, h) { width = w; height = h; sceneRT.setSize(w, h); blurRT.setSize(w, h); bloomA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); bloomB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); U.uRes.value.set(w, h); applica(); },
    setLook(l) { Object.assign(look, l); applica(); },
    /** focusY: quota sullo schermo (0 basso … 1 alto) nitida; amount: 0 nessuna sfocatura … 1 piena */
    render(scene, camera, focusY = 0.5, amount = 1) {
      focus.x = focusY; focus.z = amount; U.uTime.value = performance.now() / 1000;
      renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
      if (look.bagliore > 0.001) {
        pass(bright, sceneRT.texture, bloomA);
        blur.uniforms.uStep.value.set(1.6 / bloomA.width, 0); pass(blur, bloomA.texture, bloomB);
        blur.uniforms.uStep.value.set(0, 1.6 / bloomA.height); pass(blur, bloomB.texture, bloomA);
      }
      pass(tilt, sceneRT.texture, blurRT);
      U.tScene.value = sceneRT.texture; U.tBloom.value = bloomA.texture;
      pass(final, blurRT.texture, null);
    },
  };
}
