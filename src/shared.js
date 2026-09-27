import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 全シーン共通のユニフォーム（時間・コースティクス・水流）
// ---------------------------------------------------------------------------
export const globalUniforms = {
  uTime: { value: 0 },
  uCausticStrength: { value: 1.2 },
  uCausticScale: { value: 0.16 },
  uCausticColor: { value: new THREE.Color(1, 1, 1) },
  uCurrent: { value: new THREE.Vector2(1, 0.25).normalize() },
  uSurfaceY: { value: 8 },
  // 水の色ごとの吸収係数（赤が最も早く吸収される）
  uAbsorb: { value: new THREE.Vector3(0.055, 0.022, 0.028) },
};

// ---------------------------------------------------------------------------
// シード付き乱数
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.float(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  gauss() {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

// ---------------------------------------------------------------------------
// 3D Simplex noise（Stefan Gustavson 版の移植）
// ---------------------------------------------------------------------------
const grad3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export function createNoise3D(seed = 1) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  const F3 = 1 / 3, G3 = 1 / 6;
  return function noise3(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0;
    else {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0;
    else {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0;
    else {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0;
    else {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  };
}

export function fbm3(noise, x, y, z, octaves = 4, lac = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Catmull-Rom で等間隔コントロール値を補間（t: 0..1）
export function sampleCurve(values, t) {
  const n = values.length - 1;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = values[Math.max(i - 1, 0)], p1 = values[i], p2 = values[i + 1], p3 = values[Math.min(i + 2, n)];
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

// ---------------------------------------------------------------------------
// GLSL チャンク
// ---------------------------------------------------------------------------
export const CAUSTIC_GLSL = /* glsl */ `
uniform float uTime;
uniform float uCausticStrength;
uniform float uCausticScale;
uniform vec3 uCausticColor;
uniform float uSurfaceY;
vec2 cHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// 細胞の境界＝光が集まる線（水面の波がレンズになってできる網目）
float causticNet(vec2 x, float t) {
  // 二段の歪みで角を消し、波打つ線にする
  x += 0.55 * vec2(sin(x.y * 0.9 + t * 0.8), cos(x.x * 0.8 - t * 0.7));
  x += 0.18 * vec2(sin(x.y * 2.7 - t * 1.3), cos(x.x * 2.3 + t * 1.1));
  vec2 n = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = cHash(n + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float core = pow(1.0 - smoothstep(0.0, 0.1, edge), 2.0);
  float glow = pow(1.0 - smoothstep(0.0, 0.34, edge), 3.0);
  return core + glow * 0.45;
}
vec3 causticAt(vec3 wp) {
  // 光源の傾きに沿って投影し、深さに応じてぼかす
  float depth = uSurfaceY - wp.y;
  vec2 base = (wp.xz + vec2(0.3, -0.12) * depth) * uCausticScale * 12.0;
  float t = uTime * 0.55;
  float a = causticNet(base, t);
  float b = causticNet(base * 0.62 + 17.3, t * 0.8 + 3.0);
  float net = max(a, b * 0.8) + a * b * 0.6;
  // 浅いほどくっきり、深いほど淡く
  float fade = clamp(1.0 - depth * 0.04, 0.35, 1.0);
  // わずかな色の分散（虹色のにじみ）
  return vec3(net * 0.97, net, net * 1.04) * uCausticColor * fade;
}
`;

// ---------------------------------------------------------------------------
// マテリアルパッチ: コースティクスと水流による揺れ
//   opts.caustics: true でコースティクス
//   opts.sway: { amp, speed, freq } で aSway 属性を使った揺れ
//   opts.extraVertex / extraFragment: 追加の文字列挿入（任意）
// ---------------------------------------------------------------------------
export function patchMaterial(material, opts = {}) {
  const caustics = opts.caustics !== false;
  const sway = opts.sway || null;
  const swayU = sway
    ? {
        uSwayAmp: { value: sway.amp ?? 0.1 },
        uSwaySpeed: { value: sway.speed ?? 1.0 },
        uSwayFreq: { value: sway.freq ?? 0.5 },
      }
    : {};
  material.userData.swayUniforms = swayU;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, globalUniforms, swayU);

    let vHead = 'varying vec3 vCWorld;\nvarying float vCNy;\nuniform float uTime;\nuniform vec2 uCurrent;\n';
    if (sway) vHead += 'attribute float aSway;\nuniform float uSwayAmp;\nuniform float uSwaySpeed;\nuniform float uSwayFreq;\n';
    shader.vertexShader = vHead + shader.vertexShader;

    if (sway) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 swBase = position;
          mat3 swRot = mat3(1.0);
          #ifdef USE_INSTANCING
            swBase = instanceMatrix[3].xyz;
            swRot = mat3(instanceMatrix);
          #endif
          swBase = (modelMatrix * vec4(swBase, 1.0)).xyz;
          float ph = uTime * uSwaySpeed + swBase.x * uSwayFreq + swBase.z * uSwayFreq * 0.7;
          float gust = 0.55 + 0.45 * sin(uTime * 0.23 + swBase.x * 0.08);
          float h = aSway;
          float h2 = h * h;
          vec2 cur = uCurrent;
          vec2 perp = vec2(-cur.y, cur.x);
          float a = (sin(ph) * 0.7 + 0.35 + sin(ph * 2.31 + 1.7) * 0.18) * gust;
          float b = sin(ph * 0.73 + 2.1) * 0.45;
          vec3 wOff = vec3(cur.x * a + perp.x * b, 0.0, cur.y * a + perp.y * b) * uSwayAmp * h2;
          wOff.y = -length(wOff) * 0.25 * h; // しなって少し下がる
          #ifdef USE_INSTANCING
            float s2 = dot(swRot[0], swRot[0]);
            transformed += (transpose(swRot) * wOff) / max(s2, 1e-5);
          #else
            transformed += wOff;
          #endif
        }`
      );
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      {
        vec4 cw = vec4(transformed, 1.0);
        vec3 cn = objectNormal;
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
          cn = mat3(instanceMatrix) * cn;
        #endif
        cw = modelMatrix * cw;
        vCWorld = cw.xyz;
        vCNy = normalize(mat3(modelMatrix) * cn).y;
      }`
    );
    if (opts.extraVertex) shader.vertexShader = opts.extraVertex(shader.vertexShader);

    shader.fragmentShader = 'varying vec3 vCWorld;\nvarying float vCNy;\n' + CAUSTIC_GLSL + shader.fragmentShader;
    if (caustics) {
      const k = opts.causticMul ?? 1.0;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 cst = causticAt(vCWorld);
          float facing = smoothstep(-0.35, 0.9, vCNy);
          float ck = facing * ${k.toFixed(3)};
          vec3 cmul = mix(vec3(1.0), vec3(0.5) + cst * uCausticStrength, ck);
          reflectedLight.directDiffuse *= cmul;
          reflectedLight.directSpecular *= mix(vec3(1.0), vec3(0.8) + cst * uCausticStrength * 0.5, ck);
        }`
      );
    }
    if (opts.extraFragment) shader.fragmentShader = opts.extraFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () =>
    `aq-${caustics ? 1 : 0}-${sway ? 1 : 0}-${opts.key || ''}-${opts.causticMul ?? 1}`;
  return material;
}

// ---------------------------------------------------------------------------
// 円形のソフトスプライト（粒子・泡用）
// ---------------------------------------------------------------------------
export function makeSpriteTexture(kind = 'soft') {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (kind === 'bubble') {
    const grd = g.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.05)');
    grd.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    grd.addColorStop(0.9, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.ellipse(s * 0.36, s * 0.34, s * 0.09, s * 0.06, -0.6, 0, Math.PI * 2);
    g.fill();
  } else {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 頂点カラー用ヘルパー
export function setVertexColors(geometry, fn) {
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (nrm) n.fromBufferAttribute(nrm, i);
    fn(p, n, c, i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}
