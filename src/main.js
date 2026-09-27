import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { globalUniforms } from './shared.js';
import { VolumetricLightPass } from './volumetric.js';
import { createSpeciesMesh } from './fish/fishFactory.js';
import { School } from './fish/school.js';
import { buildFreshwater, FRESH_CONFIG } from './scenes/freshwater.js';
import { buildMarine, MARINE_CONFIG } from './scenes/marine.js';

// ---------------------------------------------------------------------------
// 高さで色が変わる水の霞（水面近くは明るく、深いほど青く沈む）
// ---------------------------------------------------------------------------
THREE.ShaderChunk.fog_pars_vertex = THREE.ShaderChunk.fog_pars_vertex.replace(
  'varying float vFogDepth;',
  'varying float vFogDepth;\nvarying float vFogWorldY;'
);
THREE.ShaderChunk.fog_vertex = THREE.ShaderChunk.fog_vertex.replace(
  'vFogDepth = - mvPosition.z;',
  `vFogDepth = - mvPosition.z;
  {
    vec4 fogW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      fogW = instanceMatrix * fogW;
    #endif
    vFogWorldY = (modelMatrix * fogW).y;
  }`
);
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace(
  'varying float vFogDepth;',
  'varying float vFogDepth;\nvarying float vFogWorldY;\nuniform vec3 uAbsorb;'
);
// 色ごとの吸収（ベール＝ランベルト則）：遠いものほど白く濁るのではなく、エメラルド／青に沈む
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec3 fogT = exp(-uAbsorb * vFogDepth);
  vec3 fogC = fogColor * mix(0.7, 1.25, smoothstep(0.0, 8.5, vFogWorldY));
  gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogC * (1.0 - fogT);
#endif`;

// ---------------------------------------------------------------------------
// 品質設定
// ---------------------------------------------------------------------------
const isTouch = matchMedia('(pointer: coarse)').matches;
const smallScreen = Math.min(screen.width, screen.height) < 820;
const quality = {
  low: isTouch || smallScreen || (navigator.hardwareConcurrency || 8) <= 4,
};
let pixelRatio = Math.min(window.devicePixelRatio, quality.low ? 1.25 : 1.5);

// ---------------------------------------------------------------------------
// レンダラー
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);

const rt = new THREE.WebGLRenderTarget(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, {
  type: THREE.HalfFloatType,
  samples: quality.low ? 2 : 4,
});
// 光の柱の計算にシーンの深度を使う
rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(pixelRatio);
const renderPass = new RenderPass(new THREE.Scene(), camera);
composer.addPass(renderPass);
// 水面から差し込む光の柱（深度が必要なので RenderPass の直後）
const volLight = new VolumetricLightPass(camera, { steps: quality.low ? 18 : 32, scale: quality.low ? 0.35 : 0.5 });
composer.addPass(volLight);
// NaN / 極端な値がブルームで画面全体に広がらないようにする
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = vec4(min(c.rgb, vec3(40.0)), 1.0); }`,
  })
);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.35, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      float ca = 0.006 * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - d * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + d * ca).b;
      // やわらかいコントラストと周辺減光
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.2);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 1.14);
      float vig = smoothstep(0.95, 0.2, sqrt(r2) * 1.05);
      col *= mix(0.72, 1.0, vig);
      col *= uTint;
      col += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finalPass);

// ---------------------------------------------------------------------------
// シーン構築
// ---------------------------------------------------------------------------
const MODES = {
  fresh: { config: FRESH_CONFIG, build: buildFreshwater, label: '海水に切り替え' },
  marine: { config: MARINE_CONFIG, build: buildMarine, label: '淡水に切り替え' },
};
const built = {};

function makeEnvMap(cfg) {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uTop: { value: new THREE.Color(cfg.top) }, uMid: { value: new THREE.Color(cfg.mid) }, uBottom: { value: new THREE.Color(cfg.bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop,uMid,uBottom; varying vec3 vP;
      void main(){ float y = normalize(vP).y; vec3 c = y > 0.0 ? mix(uMid, uTop, pow(y, 0.6)) : mix(uMid, uBottom, pow(-y, 0.5));
      c += vec3(1.0) * pow(max(0.0, y), 24.0) * 2.0; gl_FragColor = vec4(c, 1.0); }`,
  });
  envScene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return tex;
}

function portraitFactor() {
  return window.innerWidth < window.innerHeight ? 1 : 0;
}

function buildMode(key) {
  const { config, build } = MODES[key];
  const scene = new THREE.Scene();
  const { group, world } = build(quality);
  scene.add(group);
  scene.fog = new THREE.FogExp2(config.fog.color, config.fog.density);
  scene.environment = makeEnvMap(config.env);
  scene.environmentIntensity = 0.9;

  const sun = new THREE.DirectionalLight(config.sun.color, config.sun.intensity);
  sun.position.set(...config.sun.pos);
  sun.castShadow = true;
  const sm = quality.low ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -15;
  sc.right = 15;
  sc.top = 10;
  sc.bottom = -10;
  sc.near = 5;
  sc.far = 50;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(config.hemi.sky, config.hemi.ground, config.hemi.intensity));

  // 魚
  const countScale = (quality.low ? 0.62 : 1) * (portraitFactor() ? 0.7 : 1);
  const schools = [];
  config.species.forEach((spec, i) => {
    const n = Math.max(1, Math.round(spec.count * (spec.count > 6 ? countScale : 1)));
    const mesh = createSpeciesMesh(spec, n, quality);
    scene.add(mesh);
    schools.push(new School(spec, mesh, world, 1000 + i * 17));
  });
  const entry = { scene, world, schools, config };
  built[key] = entry;
  updateBounds(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// カメラ構図（横長・縦長の両方に対応）
// ---------------------------------------------------------------------------
const camBase = new THREE.Vector3();
const camLook = new THREE.Vector3();
function layoutCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  camera.aspect = aspect;
  const portrait = aspect < 1;
  camera.fov = portrait ? 46 : 42;
  // z=0 面で見せたい高さ
  const cfg = current ? current.config : FRESH_CONFIG;
  const pc = cfg.portrait ?? {};
  let Hv = portrait ? pc.hv ?? 10.2 : 9.0;
  if (!portrait) Hv = Math.min(Hv, 21 / aspect);
  const dist = Hv / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fx = portrait ? cfg.focusX : 0;
  camBase.set(fx, portrait ? pc.camY ?? 4.55 : 4.55, dist);
  camLook.set(fx, portrait ? pc.lookY ?? 3.45 : 3.45, 0);
  camera.updateProjectionMatrix();
}

function updateBounds(entry) {
  if (!entry) return;
  const dist = camBase.z;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (dist - 0.5);
  const halfW = halfH * camera.aspect;
  const b = entry.world.bounds;
  const portrait = camera.aspect < 1;
  const extra = portrait ? 1.25 : 1.06;
  b.minX = camBase.x - halfW * extra;
  b.maxX = camBase.x + halfW * extra;
  b.minY = 0.4;
  b.maxY = entry.config.surfaceY - 0.45;
}

// ---------------------------------------------------------------------------
// モード切替（フェード）
// ---------------------------------------------------------------------------
let current = null;
let currentKey = null;
const fade = document.getElementById('fade');
const toggleBtn = document.getElementById('toggle');
const loading = document.getElementById('loading');

function applyMode(key) {
  const entry = built[key] || buildMode(key);
  current = entry;
  currentKey = key;
  renderPass.scene = entry.scene;
  const c = entry.config;
  globalUniforms.uSurfaceY.value = c.surfaceY;
  globalUniforms.uCausticStrength.value = c.caustic.strength;
  globalUniforms.uCausticColor.value.set(c.caustic.color);
  globalUniforms.uCausticScale.value = c.caustic.scale ?? 0.16;
  globalUniforms.uAbsorb.value.set(...c.water.absorb);
  renderer.toneMappingExposure = c.exposure;
  bloom.strength = c.bloom.strength;
  bloom.radius = c.bloom.radius;
  bloom.threshold = c.bloom.threshold;
  volLight.intensity = c.volume.intensity;
  volLight.color.set(c.volume.color);
  volLight.march.uniforms.uCoverage.value = c.volume.coverage;
  volLight.lightDir.set(...c.sun.pos).normalize().negate();
  toggleBtn.setAttribute('aria-label', MODES[key].label);
  toggleBtn.title = MODES[key].label;
  toggleBtn.dataset.mode = key;
  layoutCamera();
  updateBounds(entry);
}

let switching = false;
async function switchMode() {
  if (switching) return;
  switching = true;
  const next = currentKey === 'fresh' ? 'marine' : 'fresh';
  fade.classList.add('on');
  await wait(900);
  if (!built[next]) {
    loading.classList.add('on');
    await wait(50);
  }
  applyMode(next);
  // 初回コンパイルのカクつきを隠す
  renderer.compile(current.scene, camera);
  composer.render();
  loading.classList.remove('on');
  await wait(250);
  fade.classList.remove('on');
  switching = false;
  try {
    localStorage.setItem('aqua-mode', next);
  } catch (e) {
    /* 保存できなくても動作に影響なし */
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// UI（操作がないと自動で隠れる）
// ---------------------------------------------------------------------------
const ui = document.getElementById('ui');
let idleTimer = 0;
function pokeUI() {
  ui.classList.add('show');
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    ui.classList.remove('show');
    document.body.classList.add('idle');
  }, 2600);
}
['mousemove', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, pokeUI, { passive: true }));
toggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  switchMode();
});
document.getElementById('fullscreen').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});

// ---------------------------------------------------------------------------
// リサイズ・ループ
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w / 2, h / 2);
  finalPass.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  layoutCamera();
  updateBounds(current);
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let t = 0;
// 解像度調整：起動時のフェード中に一度だけ計測して決める。
// 実行中は長く重い状態が続いたときだけ、フェードで隠して一段下げる（描画バッファ再確保のちらつき防止）
const perf = { phase: 'warmup', t0: 0, samples: [], lastDrop: 0, busy: false };
let onCalibrated = null;
function setPixelRatio(pr) {
  pixelRatio = pr;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  resize();
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  tick(dt);
  managePerf(dt);
}
function managePerf(dt) {
  perf.t0 += dt;
  if (perf.phase === 'warmup') {
    if (perf.t0 > 0.6) {
      perf.phase = 'calibrate';
      perf.t0 = 0;
      perf.samples.length = 0;
    }
    return;
  }
  perf.samples.push(dt);
  if (perf.phase === 'calibrate') {
    if (perf.t0 < 1.2) return;
    const avg = median(perf.samples);
    // 目標 55fps。足りない分だけ面積比で解像度を下げる
    const target = 1 / 55;
    if (avg > target) setPixelRatio(Math.max(0.75, Math.min(pixelRatio, pixelRatio * Math.sqrt(target / avg))));
    perf.phase = 'run';
    perf.t0 = 0;
    perf.samples.length = 0;
    if (onCalibrated) onCalibrated();
    return;
  }
  if (perf.samples.length > 600) perf.samples.shift();
  if (perf.busy || perf.samples.length < 600 || t - perf.lastDrop < 30 || pixelRatio <= 0.75) return;
  const avg = median(perf.samples);
  if (avg > 1 / 30) {
    perf.busy = true;
    perf.lastDrop = t;
    fade.classList.add('quick', 'on');
    setTimeout(() => {
      setPixelRatio(Math.max(0.75, pixelRatio - 0.2));
      perf.samples.length = 0;
      requestAnimationFrame(() => {
        fade.classList.remove('on');
        setTimeout(() => {
          fade.classList.remove('quick');
          perf.busy = false;
        }, 400);
      });
    }, 320);
  }
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
function tick(dt) {
  t += dt;
  globalUniforms.uTime.value = t;
  finalPass.uniforms.uTime.value = t;

  // ごくわずかな浮遊感（ドキュメンタリーのカメラのような揺れ）
  camera.position.set(camBase.x + Math.sin(t * 0.07) * 0.18, camBase.y + Math.sin(t * 0.11) * 0.07, camBase.z + Math.sin(t * 0.05) * 0.12);
  camera.lookAt(camLook.x + Math.sin(t * 0.06 + 1) * 0.12, camLook.y, camLook.z);

  if (current) {
    for (const s of current.schools) s.update(dt, t, current.schools);
  }
  composer.render();
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
let startKey = 'fresh';
try {
  const saved = localStorage.getItem('aqua-mode');
  if (saved && MODES[saved]) startKey = saved;
} catch (e) {
  /* 既定の淡水で開始 */
}
const params = new URLSearchParams(location.search);
if (params.get('mode') && MODES[params.get('mode')]) startKey = params.get('mode');

// ローディング表示を一度描かせてから重い構築処理に入る
setTimeout(() => {
  layoutCamera();
  applyMode(startKey);
  resize();
  renderer.compile(current.scene, camera);
  // フェードをかけたまま解像度を決めてから見せる
  onCalibrated = () => {
    onCalibrated = null;
    loading.classList.remove('on');
    setTimeout(() => fade.classList.remove('on'), 120);
    pokeUI();
  };
  renderer.setAnimationLoop(frame);
}, 60);

if (import.meta.env.DEV) {
  // 開発時の確認用: 指定サイズで数フレーム進めて PNG を保存
  window.__aqua = {
    renderer, composer, camera, bloom, volLight, THREE,
    get current() { return current; },
    switchMode,
    tick,
    async shot(name, w = 1280, h = 720, frames = 30, cam = null) {
      renderer.setAnimationLoop(null);
      const saved = [window.innerWidth, window.innerHeight];
      Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      composer.setPixelRatio(1);
      resize();
      for (let i = 0; i < frames; i++) tick(1 / 30);
      if (cam) {
        camera.position.set(...cam.pos);
        camera.lookAt(...cam.look);
        composer.render();
      }
      const url = renderer.domElement.toDataURL('image/png');
      await fetch('/__shot?name=' + name, { method: 'POST', body: url });
      Object.defineProperty(window, 'innerWidth', { value: saved[0], configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: saved[1], configurable: true });
      return 'saved';
    },
  };
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) renderer.setAnimationLoop(null);
  else {
    clock.getDelta();
    renderer.setAnimationLoop(frame);
  }
});
