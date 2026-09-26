import * as THREE from 'three';
import { buildFishGeometry } from './fishGeometry.js';
import { patchMaterial, globalUniforms, Rng } from '../shared.js';

// ---------------------------------------------------------------------------
// ペイント用ヘルパー（魚ローカル座標 → キャンバス座標）
// ---------------------------------------------------------------------------
function makePainter(spec, F, W, H) {
  const ye = spec.texYExt;
  const X = (x) => (x + 0.5) * W;
  const Y = (y) => (1 - (y + ye) / (2 * ye)) * H;
  const S = (d) => d * W;
  const SY = (d) => (d / (2 * ye)) * H;
  const P = {
    W, H, X, Y, S, SY, F, rng: new Rng(spec.seed ?? 7),
    top: F.top, bot: (x) => -F.bot(x), center: F.center,
    // 胴体内の相対高さ v（0=腹, 1=背）→ y
    at: (x, v) => -F.bot(x) + (F.top(x) + F.bot(x)) * v,
    fill(ctx, color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
    },
    // 体の輪郭に沿った縦方向グラデーション（stops: [[v, color], ...]）
    band(ctx, stops, x0 = -0.5, x1 = 0.5, alpha = 1) {
      const step = 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let px = Math.floor(X(x0)); px < X(x1); px += step) {
        const x = px / W - 0.5;
        const xc = Math.max(F.xb, Math.min(0.5, x));
        const yt = Y(P.at(xc, 1)), yb = Y(P.at(xc, 0));
        const g = ctx.createLinearGradient(0, yb, 0, yt);
        for (const [v, c] of stops) g.addColorStop(Math.max(0, Math.min(1, v)), c);
        ctx.fillStyle = g;
        const pad = 6;
        ctx.fillRect(px, yt - pad, step + 0.5, yb - yt + pad * 2);
      }
      ctx.restore();
    },
    grad(ctx, x1, y1, x2, y2, stops) {
      const g = ctx.createLinearGradient(X(x1), Y(y1), X(x2), Y(y2));
      for (const [t, c] of stops) g.addColorStop(t, c);
      return g;
    },
    radial(ctx, x, y, r, stops) {
      const g = ctx.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), S(r));
      for (const [t, c] of stops) g.addColorStop(t, c);
      return g;
    },
    // 体内の相対高さで表す線（pts: [[x, v], ...] v は相対高さ、abs:true なら y）
    stripe(ctx, pts, width, color, opts = {}) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = SY(width);
      ctx.lineCap = opts.cap ?? 'round';
      ctx.lineJoin = 'round';
      if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
      if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
      ctx.beginPath();
      const n = opts.samples ?? 48;
      const pp = pts.map(([x, v]) => [x, opts.abs ? v : null, v]);
      // 線形補間でサンプリングして輪郭追従させる
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const f = t * (pp.length - 1);
        const k = Math.min(Math.floor(f), pp.length - 2);
        const u = f - k;
        const x = pp[k][0] + (pp[k + 1][0] - pp[k][0]) * u;
        const v = pp[k][2] + (pp[k + 1][2] - pp[k][2]) * u;
        const xc = Math.max(F.xb, Math.min(0.5, x));
        const y = opts.abs ? v : P.at(xc, v);
        if (i === 0) ctx.moveTo(X(x), Y(y));
        else ctx.lineTo(X(x), Y(y));
      }
      ctx.stroke();
      ctx.restore();
    },
    // 縦帯（x 中心、幅 w、y1..y2 は絶対座標。curve で弓なり）
    bar(ctx, x, w, color, opts = {}) {
      const y1 = opts.y1 ?? spec.texYExt, y2 = opts.y2 ?? -spec.texYExt;
      const curve = opts.curve ?? 0;
      ctx.save();
      if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
      if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const y = y1 + (y2 - y1) * t;
        const off = curve * Math.sin(t * Math.PI) + (opts.slant ?? 0) * (t - 0.5);
        const ww = w * (opts.taper ? 1 - opts.taper * Math.abs(t - 0.5) * 2 : 1);
        const px = X(x + off - ww / 2);
        if (i === 0) ctx.moveTo(px, Y(y));
        else ctx.lineTo(px, Y(y));
      }
      for (let i = n; i >= 0; i--) {
        const t = i / n;
        const y = y1 + (y2 - y1) * t;
        const off = curve * Math.sin(t * Math.PI) + (opts.slant ?? 0) * (t - 0.5);
        const ww = w * (opts.taper ? 1 - opts.taper * Math.abs(t - 0.5) * 2 : 1);
        ctx.lineTo(X(x + off + ww / 2), Y(y));
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    ellipse(ctx, x, y, rx, ry, color, rot = 0, blur = 0) {
      ctx.save();
      if (blur) ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(X(x), Y(y), S(rx), S(ry), rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    dot(ctx, x, y, r, color, blur = 0) {
      ctx.save();
      if (blur) ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X(x), Y(y), S(r), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    poly(ctx, pts, color, blur = 0) {
      ctx.save();
      if (blur) ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    // 胴体の輪郭パスでクリップ
    clipBody(ctx, grow = 0) {
      ctx.beginPath();
      const n = 80;
      for (let i = 0; i <= n; i++) {
        const x = F.xb + (0.5 - F.xb) * (i / n);
        const y = F.top(x) + grow;
        i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y));
      }
      for (let i = n; i >= 0; i--) {
        const x = F.xb + (0.5 - F.xb) * (i / n);
        ctx.lineTo(X(x), Y(-F.bot(x) - grow));
      }
      ctx.closePath();
      ctx.clip();
    },
    // 細かい斑点・ノイズ
    speckle(ctx, count, colorFn, rMin, rMax, region) {
      const r = P.rng;
      for (let i = 0; i < count; i++) {
        const x = region ? r.float(region[0], region[1]) : r.float(F.xb, 0.5);
        const v = r.float(region ? region[2] ?? 0 : 0, region ? region[3] ?? 1 : 1);
        const y = P.at(Math.max(F.xb, Math.min(0.5, x)), v);
        ctx.fillStyle = colorFn(r, x, v);
        ctx.beginPath();
        ctx.arc(X(x), Y(y), r.float(rMin, rMax) * W, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
  return P;
}

function canvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

// 共有のウロコ凹凸テクスチャ
let scaleTex = null;
function getScaleTexture() {
  if (scaleTex) return scaleTex;
  const W = 512, H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, W, H);
  const cols = 64, rows = 30;
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols + 1; k++) {
      const x = k * cw + (r % 2) * cw * 0.5;
      const y = r * rh;
      const grd = g.createRadialGradient(x - cw * 0.2, y, 0, x - cw * 0.2, y, cw * 0.95);
      grd.addColorStop(0, '#9a9a9a');
      grd.addColorStop(0.75, '#858585');
      grd.addColorStop(1, '#5a5a5a');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, y, cw * 0.95, rh * 1.05, 0, -Math.PI / 2, Math.PI / 2);
      g.fill();
    }
  }
  scaleTex = new THREE.CanvasTexture(c);
  scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping;
  return scaleTex;
}

function eyeTexture(iris, ring) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  // 上端（v=1）が外向きの極 → 瞳
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#010101');
  grd.addColorStop(0.3, '#030303');
  grd.addColorStop(0.33, ring || iris);
  grd.addColorStop(0.38, iris);
  grd.addColorStop(0.46, '#1a1814');
  grd.addColorStop(1, '#0a0a0a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// 泳ぎのシェーダーパッチ
// ---------------------------------------------------------------------------
const SWIM_HEAD = /* glsl */ `
attribute vec4 aSwim;
attribute vec4 aFin;
uniform float uWaveK;
uniform float uHeadAmp;
uniform float uFlutter;
uniform float uFlutterSpeed;
`;
const SWIM_NORMAL = /* glsl */ `
  float sw_s = clamp(0.5 - position.x, 0.0, 1.0);
  float sw_env = uHeadAmp + sw_s * sw_s;
  float sw_arg = uWaveK * sw_s - aSwim.x;
  float sw_w = sin(sw_arg);
  float sw_dz = aSwim.y * sw_env * sw_w;
  float sw_dds = aSwim.y * (2.0 * sw_s * sw_w + sw_env * uWaveK * cos(sw_arg));
  float sw_bx = position.x - 0.12;
  sw_dz += aSwim.z * sw_bx * sw_bx;
  float sw_dzdx = -sw_dds + 2.0 * aSwim.z * sw_bx;
  float sw_fl = aFin.w;
  float sw_lag = sin(sw_arg - 1.1) * aSwim.y * sw_fl * 0.7;
  float sw_flut = (sin(uTime * uFlutterSpeed + aSwim.w + position.x * 9.0 + position.y * 5.0) * 0.7
                 + sin(uTime * uFlutterSpeed * 1.73 + aSwim.w * 2.0 + position.y * 11.0) * 0.3) * uFlutter * sw_fl;
  vec3 sw_fin = aFin.xyz * (sw_lag + sw_flut);
`;

function swimPatch(material, spec, depthOnly = false) {
  const u = {
    uWaveK: { value: spec.swim?.waveK ?? 5.5 },
    uHeadAmp: { value: spec.swim?.headAmp ?? 0.08 },
    uFlutter: { value: spec.swim?.flutter ?? 0.03 },
    uFlutterSpeed: { value: spec.swim?.flutterSpeed ?? 7.0 },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    Object.assign(shader.uniforms, u, { uTime: globalUniforms.uTime });
    shader.vertexShader = SWIM_HEAD + (depthOnly ? 'uniform float uTime;\n' : '') + shader.vertexShader;
    if (depthOnly) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${SWIM_NORMAL}\ntransformed.z += sw_dz; transformed += sw_fin;`
      );
    } else {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>\n${SWIM_NORMAL}\nobjectNormal = normalize(vec3(objectNormal.x - sw_dzdx * objectNormal.z, objectNormal.y, objectNormal.z));`
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.z += sw_dz; transformed += sw_fin;`);
    }
    if (prev) prev(shader, r);
  };
  material.userData.swimUniforms = u;
  return material;
}

// ---------------------------------------------------------------------------
// 種ごとのインスタンスメッシュ生成
// ---------------------------------------------------------------------------
export function createSpeciesMesh(spec, count, quality) {
  const { geometry, rays, F } = buildFishGeometry(spec);
  const texScale = quality.low ? 0.5 : 1;
  const W = Math.round(512 * texScale);
  const H = Math.round(W * 2 * spec.texYExt);
  const bodyC = canvas(W, H);
  const finC = canvas(W, H);
  const glowC = spec.glow ? canvas(W, H) : null;
  const bctx = bodyC.getContext('2d');
  const fctx = finC.getContext('2d');
  const P = makePainter(spec, F, W, H);
  spec.paint(bctx, fctx, P, glowC ? glowC.getContext('2d') : null);

  // 全種共通の描き込み：背側の陰影、エラ蓋、側線、腹側の照り返し
  bctx.save();
  P.clipBody(bctx, 0.01);
  P.band(bctx, [[0, 'rgba(255,255,255,0.10)'], [0.3, 'rgba(255,255,255,0)'], [0.7, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.28)']]);
  const gx = spec.eye.x - spec.eye.r * 2.6;
  P.stripe(bctx, [[gx + 0.015, 0.15], [gx - 0.012, 0.45], [gx + 0.005, 0.8]], 0.007, 'rgba(0,0,0,0.22)', { blur: 1 });
  P.stripe(bctx, [[gx + 0.03, 0.2], [gx + 0.008, 0.45], [gx + 0.02, 0.75]], 0.01, 'rgba(255,255,255,0.08)', { blur: 1.5 });
  P.stripe(bctx, [[gx - 0.02, 0.62], [F.xb + 0.05, 0.52]], 0.004, 'rgba(0,0,0,0.12)', { blur: 0.5 });
  bctx.fillStyle = P.radial(bctx, 0.49, F.center(0.49), 0.05, [[0, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]);
  bctx.fillRect(0, 0, W, H);
  bctx.restore();

  // ヒレの鰭条（すじ）
  fctx.save();
  for (const r of rays) {
    if (!r.rays) continue;
    const n = r.root.length;
    for (let i = 0; i < n; i += 2) {
      const a = r.root[i], b = r.tip[i];
      fctx.strokeStyle = spec.rayColor ?? 'rgba(20,10,0,0.22)';
      fctx.lineWidth = Math.max(1, W / 420);
      fctx.beginPath();
      fctx.moveTo(P.X(a.x), P.Y(a.y));
      fctx.lineTo(P.X(b.x), P.Y(b.y));
      fctx.stroke();
    }
  }
  fctx.restore();

  // ヒレのアルファを底上げ（見えやすく）
  {
    const img = fctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i] * (spec.finAlpha ?? 1.4) + 8);
    fctx.putImageData(img, 0, 0);
  }

  // 体表に微細なムラ
  bctx.save();
  P.clipBody(bctx, 0.02);
  for (let i = 0; i < 900 * texScale; i++) {
    bctx.fillStyle = P.rng.next() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    bctx.fillRect(P.rng.float(0, W), P.rng.float(0, H), 2, 2);
  }
  bctx.restore();

  const toTex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const bodyTex = toTex(bodyC);
  const finTex = toTex(finC);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: bodyTex,
    roughness: spec.roughness ?? 0.42,
    metalness: spec.metal ?? 0.08,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    bumpMap: getScaleTexture(),
    bumpScale: spec.scaleBump ?? 0.6,
    envMapIntensity: (spec.envI ?? 0.9) * 0.55,
    sheen: spec.sheen ?? 0,
    sheenColor: new THREE.Color(spec.sheenColor ?? '#ffffff'),
    iridescence: spec.iridescence ?? 0,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [180, 520],
  });
  if (glowC) {
    bodyMat.emissive = new THREE.Color('#ffffff');
    bodyMat.emissiveMap = toTex(glowC);
    bodyMat.emissiveIntensity = spec.glow;
  }
  const finMat = new THREE.MeshStandardMaterial({
    map: finTex,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.45,
    metalness: 0,
    depthWrite: false,
    alphaTest: 0.02,
    envMapIntensity: 0.4,
    opacity: 1,
  });
  const eyeMat = new THREE.MeshPhysicalMaterial({
    map: eyeTexture(spec.eye.iris, spec.eye.ring),
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.4,
  });
  for (const m of [bodyMat, finMat, eyeMat]) {
    swimPatch(m, spec);
    patchMaterial(m, { caustics: true, causticMul: 0.55, key: 'fish' });
  }

  const mesh = new THREE.InstancedMesh(geometry, [bodyMat, finMat, eyeMat], count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const swim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  swim.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aSwim', swim);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  swimPatch(depth, spec, true);
  mesh.customDepthMaterial = depth;
  mesh.userData.spec = spec;
  mesh.userData.swim = swim;
  return mesh;
}
