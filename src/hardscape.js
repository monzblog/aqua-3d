import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D, fbm3, Rng, patchMaterial, clamp, smoothstep, lerp } from './shared.js';

// ---------------------------------------------------------------------------
// 石の凹凸用テクスチャ
// ---------------------------------------------------------------------------
let rockBump = null;
function getRockBump() {
  if (rockBump) return rockBump;
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  const n = createNoise3D(77);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
      // タイル可能にするため円筒座標でサンプル
      const px = Math.cos(u) * 2, py = Math.sin(u) * 2, pz = Math.cos(v) * 2, pw = Math.sin(v) * 2;
      let val = fbm3(n, px + pw * 0.5, py + pz * 0.5, pz * 0.8 + pw, 5) * 0.5 + 0.5;
      val = Math.pow(val, 1.2);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  rockBump = new THREE.CanvasTexture(c);
  rockBump.wrapS = rockBump.wrapT = THREE.RepeatWrapping;
  rockBump.repeat.set(3, 3);
  return rockBump;
}

// ---------------------------------------------------------------------------
// 石を生成
// style: 'seiryu'（青龍石：縦の筋と鋭い稜線）, 'live'（ライブロック：多孔質で石灰藻）
// ---------------------------------------------------------------------------
export function makeRockGeometry(seed, style = 'seiryu', detail = 5) {
  const noise = createNoise3D(seed);
  const noise2 = createNoise3D(seed + 101);
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const disp = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r;
    if (style === 'seiryu') {
      const big = fbm3(noise, v.x * 0.9, v.y * 0.9, v.z * 0.9, 3);
      // 縦方向に引き伸ばしたノイズ → 縦筋・亀裂
      const strata = fbm3(noise2, v.x * 3.0, v.y * 0.8, v.z * 3.0, 4);
      const crease = Math.abs(fbm3(noise2, v.x * 2.2 + 7, v.y * 1.1, v.z * 2.2, 4));
      const ridged = 1 - Math.abs(fbm3(noise, v.x * 2.6 + 5, v.y * 2.6, v.z * 2.6, 4));
      const fine = fbm3(noise2, v.x * 10, v.y * 4, v.z * 10, 3);
      r = 1 + big * 0.34 + strata * 0.14 + Math.pow(ridged, 3) * 0.2 + fine * 0.04;
      r -= Math.max(0, 0.12 - crease) * 1.1; // 細く深い溝
      // 面を平らに切ったような部分（カット面）
      const facet = Math.max(0, fbm3(noise, v.x * 1.4 + 11, v.y * 1.4, v.z * 1.4, 2));
      r -= facet * 0.14;
    } else {
      const big = fbm3(noise, v.x * 1.1, v.y * 1.1, v.z * 1.1, 3);
      const pores = fbm3(noise2, v.x * 5, v.y * 5, v.z * 5, 3);
      const holes = smoothstep(0.25, 0.55, fbm3(noise2, v.x * 2.6 + 3, v.y * 2.6, v.z * 2.6, 3));
      r = 1 + big * 0.42 + Math.abs(pores) * 0.14 - holes * 0.28;
    }
    disp[i] = r;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  geo.computeVertexNormals();
  geo.userData.disp = disp;
  return geo;
}

// 石の頂点色
function colorRock(geo, style, seed, palette) {
  const noise = createNoise3D(seed + 7);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const disp = geo.userData.disp;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const a = new THREE.Color(), b = new THREE.Color(), d = new THREE.Color(), e = new THREE.Color(), g = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = nrm.getY(i);
    const cav = clamp((disp[i] - 0.95) * 2.2, 0, 1);
    if (style === 'seiryu') {
      a.set(palette.dark);
      b.set(palette.base);
      d.set(palette.light);
      c.copy(a).lerp(b, smoothstep(0.0, 1.0, cav));
      // 稜線（凸部）を明るく
      c.lerp(d, smoothstep(0.75, 1.0, cav) * 0.35);
      const vein = Math.abs(fbm3(noise, x * 1.1, y * 2.6, z * 1.1, 3));
      if (vein < 0.022) c.lerp(d, (0.022 - vein) / 0.022 * 0.7);
      const tint = fbm3(noise, x * 1.5 + 9, y * 1.5, z * 1.5, 3);
      c.offsetHSL(tint * 0.02, 0, tint * 0.08);
      // 上面に薄い苔
      if (palette.moss) {
        e.set(palette.moss);
        const mk = smoothstep(0.55, 0.95, ny) * smoothstep(0.0, 0.5, fbm3(noise, x * 3 + 3, y * 3, z * 3, 3) + 0.2) * 0.55;
        c.lerp(e, mk);
      }
    } else {
      // ライブロック：ベージュ地に紫・ピンクの石灰藻、窪みは暗く
      a.set(palette.dark);
      b.set(palette.base);
      c.copy(a).lerp(b, cav * 0.9 + 0.1);
      const cor = fbm3(noise, x * 2.2, y * 2.2, z * 2.2, 4);
      d.set(palette.coralline);
      e.set(palette.coralline2);
      g.set(palette.algae);
      if (cor > 0.0) c.lerp(d, smoothstep(0.0, 0.3, cor) * (0.35 + 0.35 * ny) * (0.4 + 0.6 * cav));
      const cor2 = fbm3(noise, x * 3.5 + 20, y * 3.5, z * 3.5, 3);
      if (cor2 > 0.2) c.lerp(e, smoothstep(0.2, 0.45, cor2) * 0.6 * (0.4 + 0.6 * cav));
      const alg = fbm3(noise, x * 4 + 40, y * 4, z * 4, 3);
      if (alg > 0.25 && ny > 0.2) c.lerp(g, smoothstep(0.25, 0.5, alg) * 0.6);
    }
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// 三平面投影で細部（法線の揺らぎと色ムラ）を付けるパッチ（UV なしのため）
function triplanarDetail(material, scale, strength = 1.0, colorAmt = 0.35) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uTriBump = { value: getRockBump() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriW;\nvarying vec3 vTriNW;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTriW = (modelMatrix * vec4(position, 1.0)).xyz;\nvTriNW = normalize(mat3(modelMatrix) * normal);'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriW;
        varying vec3 vTriNW;
        uniform sampler2D uTriBump;
        vec3 triW;
        float triH(vec3 p) {
          p *= ${scale.toFixed(3)};
          float a = texture2D(uTriBump, p.yz).r * triW.x + texture2D(uTriBump, p.xz).r * triW.y + texture2D(uTriBump, p.xy).r * triW.z;
          vec3 q = p * 3.7;
          float b = texture2D(uTriBump, q.yz).r * triW.x + texture2D(uTriBump, q.xz).r * triW.y + texture2D(uTriBump, q.xy).r * triW.z;
          return a * 0.65 + b * 0.35;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 triN = normalize(vTriNW);
        triW = pow(abs(triN), vec3(4.0));
        triW /= (triW.x + triW.y + triW.z);
        float triH0 = triH(vTriW);
        diffuseColor.rgb *= ${(1 - colorAmt).toFixed(3)} + triH0 * ${(colorAmt * 2).toFixed(3)};`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float e = 0.02;
          vec3 g = vec3(triH(vTriW + vec3(e, 0.0, 0.0)), triH(vTriW + vec3(0.0, e, 0.0)), triH(vTriW + vec3(0.0, 0.0, e))) - triH0;
          g /= e;
          vec3 nw = normalize(triN - ${strength.toFixed(3)} * 0.05 * (g - dot(g, triN) * triN));
          vec3 nv = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
          // 元の補間法線（両面・フラット対応）に向きを合わせる
          normal = normalize(nv * sign(dot(nv, normal) + 1e-4));
        }`
      );
  };
}

export function createRock(opts) {
  const style = opts.style ?? 'seiryu';
  const geo = makeRockGeometry(opts.seed, style, opts.detail ?? 5);
  // 形を整える（縦長・傾き・底を平らに）
  const pos = geo.attributes.position;
  const sx = opts.scale[0], sy = opts.scale[1], sz = opts.scale[2];
  const taper = opts.taper ?? 0.25;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y + 1.2) / 2.4;
    const k = 1 - taper * t;
    x *= k;
    z *= k;
    if (y < -0.55) y = -0.55 + (y + 0.55) * 0.25;
    pos.setXYZ(i, x * sx, y * sy, z * sz);
  }
  geo.computeVertexNormals();
  colorRock(geo, style, opts.seed, opts.palette);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: style === 'seiryu' ? 0.82 : 0.95,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  triplanarDetail(mat, style === 'seiryu' ? 0.45 : 0.6, style === 'seiryu' ? 1.6 : 2.2, style === 'seiryu' ? 0.3 : 0.4);
  patchMaterial(mat, { caustics: true, causticMul: 1.0, key: 'rock-' + style });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(opts.position);
  mesh.rotation.set(opts.rotation?.[0] ?? 0, opts.rotation?.[1] ?? 0, opts.rotation?.[2] ?? 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.updateMatrixWorld(true);
  // 障害物（魚の回避用）
  mesh.userData.obstacle = {
    x: opts.position.x,
    y: opts.position.y + sy * 0.25,
    z: opts.position.z,
    r: Math.max(sx, sy * 0.7, sz) * 0.95,
  };
  mesh.userData.footprint = { x: opts.position.x, z: opts.position.z, rx: sx * 1.05, rz: sz * 1.05 };
  return mesh;
}

// ---------------------------------------------------------------------------
// 流木（枝分かれする先細りのチューブ）
// ---------------------------------------------------------------------------
function taperedTube(points, r0, r1, radial, noise, seedOff) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const segs = Math.max(8, Math.round(curve.getLength() * 10));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nrm = [], col = [], idx = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const N = frames.normals[i], B = frames.binormals[i];
    const rr = lerp(r0, r1, Math.pow(t, 0.8));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cs = Math.cos(a), sn = Math.sin(a);
      n.set(N.x * cs + B.x * sn, N.y * cs + B.y * sn, N.z * cs + B.z * sn);
      const knot = 1 + fbm3(noise, p.x * 2.5 + seedOff, p.y * 2.5, p.z * 2.5, 3) * 0.25 + Math.sin(a * 3 + t * 20 + seedOff) * 0.05;
      const r = rr * knot;
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nrm.push(n.x, n.y, n.z);
      // 樹皮の縦筋
      const stripe = fbm3(noise, a * 1.5 + seedOff, t * 30, seedOff, 2);
      col.push(stripe, t, n.y);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return { geo: g, curve };
}

export function createDriftwood(opts) {
  const rng = new Rng(opts.seed);
  const noise = createNoise3D(opts.seed);
  const geos = [];
  const obstacles = [];
  const tips = [];
  const segments = []; // 苔・水草を付ける場所
  const grow = (start, dir, len, r0, depth) => {
    const pts = [start.clone()];
    const d = dir.clone().normalize();
    const steps = 5;
    let p = start.clone();
    for (let i = 0; i < steps; i++) {
      d.x += rng.float(-0.35, 0.35);
      d.y += rng.float(-0.15, 0.25) + (opts.lift ?? 0.05);
      d.z += rng.float(-0.25, 0.25);
      d.normalize();
      p = p.clone().addScaledVector(d, len / steps);
      pts.push(p);
    }
    const r1 = r0 * (depth > 0 ? 0.45 : 0.08);
    const { geo, curve } = taperedTube(pts, r0, r1, depth > 1 ? 10 : 7, noise, rng.float(0, 100));
    geos.push(geo);
    segments.push({ curve, r0, r1 });
    for (let i = 0; i <= 4; i++) {
      const q = curve.getPointAt(i / 4);
      const rr = lerp(r0, r1, i / 4);
      if (rr > 0.07) obstacles.push({ x: q.x, y: q.y, z: q.z, r: rr + 0.2 });
    }
    if (depth <= 0) {
      tips.push(curve.getPointAt(1));
      return;
    }
    const kids = rng.int(1, depth > 1 ? 3 : 2);
    for (let k = 0; k < kids; k++) {
      const t = rng.float(0.45, 0.95);
      const sp = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const nd = tan.clone().add(new THREE.Vector3(rng.float(-0.9, 0.9), rng.float(-0.2, 0.6), rng.float(-0.7, 0.7))).normalize();
      grow(sp, nd, len * rng.float(0.45, 0.75), lerp(r0, r1, t) * 0.8, depth - 1);
    }
  };
  for (const root of opts.roots) grow(root.start, root.dir, root.len, root.r, root.depth ?? 3);

  const geo = mergeGeometries(geos, false);
  // 頂点色を確定
  const col = geo.attributes.color;
  const c = new THREE.Color();
  const dark = new THREE.Color(opts.palette.dark), base = new THREE.Color(opts.palette.base), light = new THREE.Color(opts.palette.light);
  for (let i = 0; i < col.count; i++) {
    const stripe = col.getX(i), ny = col.getZ(i);
    c.copy(dark).lerp(base, clamp(stripe * 1.2 + 0.6, 0, 1));
    c.lerp(light, smoothstep(0.3, 1.0, ny) * 0.35);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 });
  triplanarDetail(mat, 1.1, 1.4, 0.35);
  patchMaterial(mat, { caustics: true, key: 'wood' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.obstacles = obstacles;
  mesh.userData.tips = tips;
  mesh.userData.segments = segments;
  return mesh;
}
