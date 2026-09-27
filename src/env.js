import * as THREE from 'three';
import { globalUniforms, makeSpriteTexture, patchMaterial, Rng, createNoise3D, fbm3, smoothstep } from './shared.js';

// ---------------------------------------------------------------------------
// 背景（バックスクリーンのグラデーション）
// ---------------------------------------------------------------------------
export function createBackdrop(cfg) {
  const geo = new THREE.PlaneGeometry(120, 40, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(cfg.top) },
      uMid: { value: new THREE.Color(cfg.mid) },
      uBottom: { value: new THREE.Color(cfg.bottom) },
      uGlow: { value: new THREE.Color(cfg.glow) },
      uGlowPos: { value: new THREE.Vector2(cfg.glowX ?? 0, cfg.glowY ?? 0.2) },
      uTime: globalUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uBottom, uGlow;
      uniform vec2 uGlowPos;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float y = (vW.y + 2.0) / 14.0;
        vec3 c = mix(uBottom, uMid, smoothstep(0.0, 0.45, y));
        c = mix(c, uTop, smoothstep(0.4, 1.0, y));
        float gx = (vW.x - uGlowPos.x * 20.0) / 26.0;
        float gy = (y - uGlowPos.y) / 0.45;
        float g = exp(-(gx * gx + gy * gy) * 1.4);
        c += uGlow * g;
        // ゆらぐ光
        float w = sin(vW.x * 0.35 + uTime * 0.25) * sin(vW.x * 0.13 - uTime * 0.17 + vW.y * 0.2);
        c *= 1.0 + w * 0.035;
        c += (hash(vUv * 900.0 + fract(uTime)) - 0.5) * 0.012;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthWrite: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 10, cfg.z ?? -8);
  mesh.renderOrder = -10;
  return mesh;
}

// ---------------------------------------------------------------------------
// 水面（水中から見上げた面：全反射と Snell の窓）
// ---------------------------------------------------------------------------
export function createSurface(cfg) {
  const geo = new THREE.PlaneGeometry(80, 40, 1, 1);
  geo.rotateX(Math.PI / 2); // 法線を下向きに
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uDeep: { value: new THREE.Color(cfg.deep) },
      uReflect: { value: new THREE.Color(cfg.reflect) },
      uSky: { value: new THREE.Color(cfg.sky) },
      uFogColor: { value: new THREE.Color(cfg.fog) },
      uFogDensity: { value: cfg.fogDensity ?? 0.03 },
      uEdge: { value: new THREE.Color(cfg.edge ?? cfg.fog) },
      uSunXZ: { value: new THREE.Vector2(...(cfg.sunXZ ?? [-3, -2])) },
      uSunPower: { value: cfg.sunPower ?? 5 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep, uReflect, uSky, uFogColor, uEdge;
      uniform vec2 uSunXZ;
      uniform float uSunPower;
      uniform float uFogDensity;
      varying vec3 vW;
      vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
      float gnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
                   mix(dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
      }
      float height(vec2 p) {
        float t = uTime;
        float h = gnoise(p * 0.6 + vec2(t * 0.12, t * 0.05)) * 0.6;
        h += gnoise(p * 1.4 - vec2(t * 0.2, -t * 0.13)) * 0.3;
        h += gnoise(p * 3.1 + vec2(-t * 0.31, t * 0.22)) * 0.12;
        h += sin(p.x * 0.9 + t * 0.7) * 0.08 + sin(p.y * 1.3 - t * 0.5) * 0.06;
        return h;
      }
      void main() {
        vec2 p = vW.xz;
        float e = 0.05;
        float h0 = height(p);
        float hx = height(p + vec2(e, 0.0));
        float hz = height(p + vec2(0.0, e));
        vec3 n = normalize(vec3(-(hx - h0) / e * 0.35, 1.0, -(hz - h0) / e * 0.35));
        vec3 v = normalize(vW - cameraPosition);
        float cosI = clamp(dot(v, n), 0.0, 1.0);
        // 臨界角 ~48.6度（cos=0.66）
        float window = smoothstep(0.6, 0.72, cosI);
        vec3 refl = mix(uDeep, uReflect, smoothstep(-0.4, 0.8, h0) * 0.7 + 0.15);
        vec3 col = mix(refl, uSky, window);
        // きらめき
        float spark = pow(max(0.0, 1.0 - abs(cosI - 0.66) * 12.0), 3.0);
        col += uSky * spark * 0.55;
        float caust = pow(max(0.0, h0 * 0.7 + 0.5), 6.0);
        col += uSky * caust * 0.35;
        // 太陽が差し込む一帯：波で揺れる強い輝き（光芒の光源になる）
        vec2 sd = (vW.xz - uSunXZ) / vec2(4.2, 2.6);
        float sunG = exp(-dot(sd, sd));
        // 波の山だけが強く光る＝きらめく網目
        float ripple = pow(smoothstep(-0.1, 0.8, h0), 3.0) + spark * 1.5;
        col += uSky * sunG * ripple * uSunPower;
        col += uSky * pow(sunG, 3.0) * uSunPower * 0.25;
        float dist = length(vW - cameraPosition);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fogF * 0.75 * (1.0 - sunG * 0.7));
        col = mix(col, uEdge, smoothstep(-3.5, -7.9, vW.z));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = cfg.y;
  return mesh;
}

// ---------------------------------------------------------------------------
// 光の筋（ゴッドレイ）
// ---------------------------------------------------------------------------
export function createLightRays(cfg, rng) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uColor: { value: new THREE.Color(cfg.color) },
      uIntensity: { value: cfg.intensity ?? 0.12 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv;
      varying float vSeed;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vSeed = aSeed;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vSeed;
      varying vec3 vW;
      void main() {
        float edge = pow(max(sin(vUv.x * 3.14159), 0.0), 1.6);
        // 水面近くが最も明るく、深くなるほど拡散して消える
        float fall = smoothstep(0.0, 0.55, vUv.y) * pow(vUv.y, 1.4);
        float t = uTime * 0.16 + vSeed * 17.0;
        // 束の中の細い筋がゆっくり流れる
        float fib = 0.62 + 0.38 * sin(vUv.x * 7.0 + sin(t) * 2.4 + vSeed * 5.0) * sin(vUv.x * 3.1 - t * 0.8 + 1.3);
        // 水面の波に合わせた明滅（ゆっくり・点滅しない）
        float breathe = 0.55 + 0.45 * sin(uTime * 0.21 + vSeed * 31.0) * sin(uTime * 0.13 + vSeed * 7.0);
        float shimmer = 0.9 + 0.1 * sin(vUv.y * 18.0 - uTime * 0.9 + vSeed * 9.0);
        float a = edge * fall * fib * breathe * shimmer * uIntensity;
        float nearFade = smoothstep(2.5, 7.0, length(vW - cameraPosition));
        gl_FragColor = vec4(uColor * a * nearFade, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const count = cfg.count ?? 12;
  for (let i = 0; i < count; i++) {
    const w = rng.float(0.5, 3.2) * (rng.next() < 0.3 ? 0.4 : 1);
    const h = cfg.height ?? 16;
    const g = new THREE.PlaneGeometry(w, h, 1, 1);
    g.translate(0, -h / 2, 0);
    const seed = new Float32Array(4).fill(rng.float(0, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.Mesh(g, mat);
    // 太陽の入射点のまわりに集める
    const cx = cfg.centerX ?? 0;
    m.position.set(cx + rng.gauss() * (cfg.spread ?? 5), cfg.top ?? 8.5, rng.float(-5, 1.5));
    m.rotation.z = (cfg.tilt ?? 0.3) + rng.float(-0.04, 0.04);
    m.rotation.y = rng.float(-0.3, 0.3);
    m.renderOrder = 5;
    group.add(m);
  }
  return group;
}

// ---------------------------------------------------------------------------
// 浮遊する微粒子
// ---------------------------------------------------------------------------
export function createParticles(cfg, rng) {
  const n = cfg.count ?? 1200;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng.float(-14, 14);
    pos[i * 3 + 1] = rng.float(0, 8.5);
    pos[i * 3 + 2] = rng.float(-6, 6);
    seed[i] = rng.float(0, 100);
    size[i] = rng.float(0.5, 1.6) * (rng.next() < 0.04 ? 2.4 : 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uMap: { value: makeSpriteTexture('soft') },
      uColor: { value: new THREE.Color(cfg.color ?? '#ffffff') },
      uScale: { value: 1 },
      uOpacity: { value: cfg.opacity ?? 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * 0.06;
        p.x += sin(t + aSeed) * 0.6 + t * 0.8;
        p.y += sin(t * 1.3 + aSeed * 1.7) * 0.4 - t * 0.25;
        p.z += cos(t * 0.9 + aSeed * 2.3) * 0.5;
        p.x = mod(p.x + 14.0, 28.0) - 14.0;
        p.y = mod(p.y, 8.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uScale * 26.0 / -mv.z;
        float d = -mv.z;
        vA = smoothstep(1.5, 4.0, d) * (1.0 - smoothstep(14.0, 26.0, d));
        vA *= 0.6 + 0.4 * sin(uTime * 0.7 + aSeed * 9.0);
        vA *= mix(0.55, 1.6, clamp(p.y / 8.5, 0.0, 1.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vA;
      void main() {
        vec4 s = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(uColor * s.a * vA * uOpacity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

// ---------------------------------------------------------------------------
// 泡（ストリームと水草の光合成の気泡）
// sources: [{x,y,z, rate, spread, size, height}]
// ---------------------------------------------------------------------------
export function createBubbles(sources, rng, surfaceY) {
  const list = [];
  for (const s of sources) {
    const n = s.count ?? 60;
    for (let i = 0; i < n; i++) list.push({ s, off: rng.float(0, 1), spd: rng.float(0.7, 1.3) * (s.speed ?? 1), sz: rng.float(0.6, 1.2) * (s.size ?? 1), jx: rng.float(-1, 1) * (s.spread ?? 0.05), jz: rng.float(-1, 1) * (s.spread ?? 0.05) });
  }
  const n = list.length;
  const pos = new Float32Array(n * 3);
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 2);
  list.forEach((e, i) => {
    pos[i * 3] = e.s.x + e.jx;
    pos[i * 3 + 1] = e.s.y;
    pos[i * 3 + 2] = e.s.z + e.jz;
    a[i * 4] = e.off;
    a[i * 4 + 1] = e.spd;
    a[i * 4 + 2] = e.sz;
    a[i * 4 + 3] = (e.s.height ?? surfaceY - e.s.y);
    b[i * 2] = rng.float(0, 100);
    b[i * 2 + 1] = e.s.pearl ? 1 : 0;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(a, 4));
  geo.setAttribute('aC', new THREE.BufferAttribute(b, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: globalUniforms.uTime, uMap: { value: makeSpriteTexture('bubble') }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aB;
      attribute vec2 aC;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      void main() {
        float cyc = fract(aB.x + uTime * aB.y * (aC.y > 0.5 ? 0.05 : 0.11));
        vec3 p = position;
        float rise = cyc * aB.w;
        p.y += rise;
        p.x += sin(uTime * 3.0 + aC.x + rise * 2.0) * 0.03 * (1.0 + rise * 0.1);
        p.z += cos(uTime * 2.6 + aC.x * 1.3 + rise * 1.7) * 0.03;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float grow = aC.y > 0.5 ? mix(0.6, 1.0, smoothstep(0.0, 0.3, cyc)) : 1.0 + rise * 0.04;
        gl_PointSize = aB.z * grow * uScale * 7.0 / -mv.z * 10.0;
        vA = smoothstep(0.0, 0.04, cyc) * (1.0 - smoothstep(0.93, 1.0, cyc));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vA;
      void main() {
        vec4 s = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.92, 0.98, 1.0) * s.a * vA * 0.9, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  return pts;
}

// ---------------------------------------------------------------------------
// 底床
// floor(x,z): 高さ関数, colorFn(x,z,h,out): 色
// ---------------------------------------------------------------------------
function grainTexture(seed, base, variance) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  const r = new Rng(seed);
  for (let i = 0; i < 26000; i++) {
    const v = Math.floor(r.float(-variance, variance));
    const l = 128 + v;
    g.fillStyle = `rgb(${l},${l},${l})`;
    const rad = r.float(0.8, 2.6);
    g.beginPath();
    g.arc(r.float(0, s), r.float(0, s), rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createSubstrate(floor, colorFn, opts = {}) {
  const w = opts.width ?? 44, d = opts.depth ?? 18;
  const geo = new THREE.PlaneGeometry(w, d, opts.segX ?? 260, opts.segZ ?? 110);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, opts.centerZ ?? -1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, floor(x, z));
  }
  geo.computeVertexNormals();
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorFn(pos.getX(i), pos.getZ(i), pos.getY(i), c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.22, pos.getZ(i) * 0.22);
  const grain = grainTexture(opts.seed ?? 5, '#808080', opts.grainVar ?? 70);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    bumpMap: grain,
    bumpScale: opts.bump ?? 1.2,
    map: grain,
    envMapIntensity: 0.4,
  });
  mat.color.setScalar(opts.brightness ?? 1.6);
  patchMaterial(mat, { caustics: true, causticMul: 1.0, key: 'sub' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// 小石を散らす
export function createPebbles(floor, rng, opts) {
  const noise = createNoise3D(opts.seed ?? 3);
  const base = new THREE.IcosahedronGeometry(1, 2);
  const p = base.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + fbm3(noise, x * 1.5, y * 1.5, z * 1.5, 3) * 0.35;
    p.setXYZ(i, x * k, y * k * 0.6, z * k);
  }
  base.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, envMapIntensity: 0.5 });
  patchMaterial(mat, { caustics: true, key: 'peb' });
  const mesh = new THREE.InstancedMesh(base, mat, opts.count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
  const c = new THREE.Color();
  let k = 0;
  let guard = 0;
  while (k < opts.count && guard++ < opts.count * 20) {
    const x = rng.float(opts.x[0], opts.x[1]);
    const z = rng.float(opts.z[0], opts.z[1]);
    if (opts.mask && !opts.mask(x, z, rng)) continue;
    const r = rng.float(opts.size[0], opts.size[1]) * (rng.next() < 0.08 ? 2.2 : 1);
    v.set(x, floor(x, z) + r * 0.15, z);
    e.set(rng.float(-0.3, 0.3), rng.float(0, 6.28), rng.float(-0.3, 0.3));
    q.setFromEuler(e);
    s.set(r * rng.float(0.8, 1.3), r, r * rng.float(0.8, 1.2));
    m.compose(v, q, s);
    mesh.setMatrixAt(k, m);
    const col = rng.pick(opts.colors);
    c.set(col).multiplyScalar(rng.float(0.75, 1.15));
    mesh.setColorAt(k, c);
    k++;
  }
  mesh.count = k;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export { smoothstep };
