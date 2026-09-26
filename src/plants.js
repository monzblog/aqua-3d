import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, Rng, lerp, clamp, smoothstep, createNoise3D, fbm3 } from './shared.js';

// ---------------------------------------------------------------------------
// 葉のジオメトリ（+y 方向に伸びる。付け根が原点）
// opts: length, width, segs, curl(反り), fold(中肋の折れ), shape(fn t→幅比), wave(波打ち)
// ---------------------------------------------------------------------------
export function leafGeometry(opts) {
  const L = opts.length ?? 1, Wd = opts.width ?? 0.3;
  const segs = opts.segs ?? 6, cols = opts.cols ?? 2;
  const shape = opts.shape ?? ((t) => Math.sin(Math.PI * Math.pow(t, 0.8)));
  const curl = opts.curl ?? 0.3, fold = opts.fold ?? 0.2, wave = opts.wave ?? 0;
  const pos = [], uv = [], sway = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = Math.max(shape(t), 0.04) * Wd * 0.5;
    const ang = curl * t * t;
    const y = Math.sin(ang) * 0 + t * L * Math.cos(ang * 0.5);
    const zc = -Math.sin(ang) * t * L * 0.5;
    for (let j = -cols; j <= cols; j++) {
      const s = j / cols;
      const x = s * w;
      const z = zc + Math.abs(s) * w * fold + (wave ? Math.sin(t * 18 + s * 3) * wave * Math.abs(s) * w : 0);
      pos.push(x, y, z);
      uv.push(s * 0.5 + 0.5, t);
      sway.push(t);
    }
  }
  const rowN = cols * 2 + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rowN - 1; j++) {
      const a = i * rowN + j, b = a + 1, c = a + rowN, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 葉脈・グラデーションのテクスチャ
function leafTexture(opts) {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, H, 0, 0);
  grd.addColorStop(0, opts.base ?? '#cfe8b0');
  grd.addColorStop(1, opts.tip ?? '#ffffff');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // 縁を少し暗く
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.25)');
  edge.addColorStop(0.2, 'rgba(0,0,0,0)');
  edge.addColorStop(0.8, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  // 中肋
  g.strokeStyle = opts.vein ?? 'rgba(255,255,230,0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 0);
  g.stroke();
  if (opts.veins !== false) {
    g.lineWidth = 1.2;
    g.strokeStyle = opts.vein2 ?? 'rgba(255,255,230,0.25)';
    for (let i = 1; i < 9; i++) {
      const y = H - (i / 9) * H;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W * 0.3, y - 12, 4, y - 26);
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W * 0.7, y - 12, W - 4, y - 26);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plantMaterial(opts) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? '#ffffff',
    map: opts.map ?? null,
    vertexColors: !!opts.vertexColors,
    roughness: opts.roughness ?? 0.6,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: opts.env ?? 0.6,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  if (opts.transmit) {
    // 葉の透過光っぽさ：裏面にも光を少し回す
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (s, r) => {
      if (prev) prev(s, r);
    };
  }
  patchMaterial(mat, {
    caustics: true,
    causticMul: opts.causticMul ?? 0.7,
    sway: opts.sway,
    key: opts.key,
    extraVertex: opts.instSway
      ? (vs) =>
          vs
            .replace('attribute float aSway;', 'attribute float aSway;\nattribute float aSwayI;')
            .replace('float h = aSway;', `float h = aSwayI + aSway * ${(opts.leafSway ?? 0.15).toFixed(3)};`)
      : null,
  });
  return mat;
}

// 汎用：インスタンス化した葉
// items: [{ pos:Vector3, quat:Quaternion, scale:Vector3|number, color:Color, sway:number }]
export function instancedLeaves(geo, mat, items) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3();
  const swayI = new Float32Array(items.length);
  items.forEach((it, i) => {
    if (typeof it.scale === 'number') s.setScalar(it.scale);
    else s.copy(it.scale);
    m.compose(it.pos, it.quat, s);
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
    swayI[i] = it.sway ?? 0;
  });
  geo.setAttribute('aSwayI', new THREE.InstancedBufferAttribute(swayI, 1));
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

function quatFromDir(dir, twist) {
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.clone().normalize());
  const t = new THREE.Quaternion().setFromAxisAngle(_up, twist);
  return q.multiply(t);
}

// ---------------------------------------------------------------------------
// 前景の絨毯（キューバパールグラス / グロッソスティグマ）
// ---------------------------------------------------------------------------
export function createCarpet(floor, rng, opts) {
  const leaf = leafGeometry({ length: 0.07, width: 0.055, segs: 2, cols: 1, curl: 0.2, fold: 0.25, shape: (t) => Math.sin(Math.PI * Math.pow(t, 0.7)) });
  const leaves = [];
  for (let k = 0; k < 5; k++) {
    const g = leaf.clone();
    g.rotateX(0.6 + (k % 2) * 0.5);
    g.rotateY((k / 5) * Math.PI * 2);
    g.translate(Math.cos(k * 2.4) * 0.025, (k % 2) * 0.012, Math.sin(k * 2.4) * 0.025);
    leaves.push(g);
  }
  const cluster = mergeGeometries(leaves);
  const tex = leafTexture({ base: '#cfeaa8', tip: '#ffffff', veins: false });
  const mat = plantMaterial({ map: tex, sway: { amp: 0.06, speed: 1.4, freq: 0.8 }, instSway: true, key: 'carpet', roughness: 0.5, causticMul: 0.9 });
  const noise = createNoise3D(opts.seed ?? 9);
  const items = [];
  const c1 = new THREE.Color(opts.colors[0]), c2 = new THREE.Color(opts.colors[1]), c3 = new THREE.Color(opts.colors[2]);
  let guard = 0;
  while (items.length < opts.count && guard++ < opts.count * 8) {
    const x = rng.float(opts.x[0], opts.x[1]);
    const z = rng.float(opts.z[0], opts.z[1]);
    const dens = opts.density(x, z);
    if (rng.next() > dens) continue;
    const y = floor(x, z);
    const n = fbm3(noise, x * 0.6, 0, z * 0.6, 3);
    const c = c1.clone().lerp(c2, clamp(n * 1.5 + 0.5, 0, 1));
    if (rng.next() < 0.15) c.lerp(c3, 0.6);
    c.multiplyScalar(rng.float(0.8, 1.1));
    const hgt = 0.5 + dens * 0.7 + n * 0.3;
    items.push({
      pos: new THREE.Vector3(x, y + rng.float(-0.01, 0.04) * hgt, z),
      quat: _q.setFromEuler(_e.set(rng.float(-0.3, 0.3), rng.float(0, 6.28), rng.float(-0.3, 0.3))).clone(),
      scale: rng.float(1.15, 1.8) * hgt,
      color: c,
      sway: 0.6,
    });
  }
  return instancedLeaves(cluster, mat, items);
}

// ---------------------------------------------------------------------------
// ヘアーグラス（エレオカリス）のような細い草の株
// ---------------------------------------------------------------------------
export function createGrassTufts(floor, rng, opts) {
  const blade = leafGeometry({ length: 1, width: opts.bladeWidth ?? 0.018, segs: 4, cols: 1, curl: 0.25, fold: 0.0, shape: (t) => 1 - t * 0.85 });
  const blades = [];
  const nb = opts.blades ?? 11;
  for (let k = 0; k < nb; k++) {
    const g = blade.clone();
    const h = rng.float(0.6, 1.0);
    g.scale(1, h, 1);
    g.rotateX(rng.float(0.05, 0.35));
    g.rotateY(rng.float(0, Math.PI * 2));
    g.translate(rng.float(-0.05, 0.05), 0, rng.float(-0.05, 0.05));
    blades.push(g);
  }
  const tuft = mergeGeometries(blades);
  const tex = leafTexture({ base: '#b8dc8c', tip: '#f0ffd8', veins: false, vein: 'rgba(255,255,255,0.2)' });
  const mat = plantMaterial({ map: tex, sway: { amp: opts.swayAmp ?? 0.18, speed: 1.1, freq: 0.5 }, instSway: true, leafSway: 1.0, key: 'grass-' + (opts.key ?? ''), roughness: 0.55 });
  const items = [];
  let guard = 0;
  while (items.length < opts.count && guard++ < opts.count * 20) {
    const x = rng.float(opts.x[0], opts.x[1]);
    const z = rng.float(opts.z[0], opts.z[1]);
    if (rng.next() > opts.density(x, z)) continue;
    const c = new THREE.Color(rng.pick(opts.colors)).multiplyScalar(rng.float(0.8, 1.1));
    items.push({
      pos: new THREE.Vector3(x, floor(x, z) - 0.02, z),
      quat: _q.setFromEuler(_e.set(0, rng.float(0, 6.28), 0)).clone(),
      scale: new THREE.Vector3(1, rng.float(opts.height[0], opts.height[1]), 1),
      color: c,
      sway: 0,
    });
  }
  return instancedLeaves(tuft, mat, items);
}

// ---------------------------------------------------------------------------
// 有茎草の茂み（ロタラ、ルドウィジア等）
// bushes: [{x, z, radius, count, height:[a,b], leaf:'round'|'narrow', colors:{base, top}, lean}]
// ---------------------------------------------------------------------------
export function createStemPlants(floor, rng, bushes, quality) {
  const stemGeos = [];
  const leafItems = { round: [], narrow: [], needle: [] };
  const stemColor = new THREE.Color();
  for (const bush of bushes) {
    const n = Math.round(bush.count * (quality.low ? 0.75 : 1.35));
    const cBase = new THREE.Color(bush.colors.base), cMid = new THREE.Color(bush.colors.mid ?? bush.colors.base), cTop = new THREE.Color(bush.colors.top);
    for (let s = 0; s < n; s++) {
      const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * bush.radius;
      const x = bush.x + Math.cos(a) * rr * (bush.sx ?? 1), z = bush.z + Math.sin(a) * rr * (bush.sz ?? 0.6);
      const y0 = floor(x, z) - 0.05;
      // 株の中心ほど高く（ドーム状のトリミング）
      const dome = 1 - Math.pow(rr / bush.radius, 2) * 0.35;
      const H = rng.float(bush.height[0], bush.height[1]) * dome;
      const lean = new THREE.Vector3(rng.float(-0.2, 0.2) + (bush.lean ?? 0), 1, rng.float(-0.15, 0.15)).normalize();
      const pts = [];
      const segs = 8;
      let p = new THREE.Vector3(x, y0, z);
      const d = lean.clone();
      for (let i = 0; i <= segs; i++) {
        pts.push(p.clone());
        d.x += rng.float(-0.05, 0.05);
        d.z += rng.float(-0.05, 0.05);
        d.normalize();
        p = p.clone().addScaledVector(d, H / segs);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, 10, bush.stemR ?? 0.012, 4, false);
      const sway = new Float32Array(tube.attributes.position.count);
      const tp = tube.attributes.position;
      for (let i = 0; i < tp.count; i++) sway[i] = clamp((tp.getY(i) - y0) / H, 0, 1) * (H / 4);
      tube.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
      tube.deleteAttribute('uv');
      const tc = new Float32Array(tp.count * 3);
      for (let i = 0; i < tp.count; i++) {
        const t = clamp((tp.getY(i) - y0) / H, 0, 1);
        stemColor.copy(cBase).lerp(cTop, smoothstep(0.5, 1, t)).multiplyScalar(0.7);
        tc[i * 3] = stemColor.r;
        tc[i * 3 + 1] = stemColor.g;
        tc[i * 3 + 2] = stemColor.b;
      }
      tube.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      stemGeos.push(tube);
      // 葉（節ごとに対生〜輪生）
      const nodes = Math.round(H * (bush.nodeDensity ?? 14) * 0.8);
      const whorl = bush.whorl ?? 2;
      const kind = bush.leaf ?? 'round';
      for (let k = 1; k <= nodes; k++) {
        const t = k / nodes;
        const pt = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        const size = (bush.leafSize ?? 0.12) * 1.8 * lerp(1.0, 0.6, Math.pow(t, 2)) * rng.float(0.85, 1.15);
        const col = t < 0.55 ? cBase.clone().lerp(cMid, t / 0.55) : cMid.clone().lerp(cTop, smoothstep(0.55, 1, t));
        col.offsetHSL(rng.float(-0.015, 0.015), 0, rng.float(-0.04, 0.04));
        for (let w = 0; w < whorl; w++) {
          const ang = (w / whorl) * Math.PI * 2 + k * 1.3;
          const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
          // 上部の葉は茎に沿って立つ
          const up = lerp(0.15, 1.3, Math.pow(t, 1.6));
          const dir = out.clone().add(tan.clone().multiplyScalar(up)).normalize();
          leafItems[kind].push({
            pos: pt.clone(),
            quat: quatFromDir(dir, ang + Math.PI / 2),
            scale: size,
            color: col,
            sway: clamp((pt.y - y0) / H, 0, 1) * (H / 4),
          });
        }
      }
    }
  }
  const group = new THREE.Group();
  const stems = mergeGeometries(stemGeos);
  const stemMat = plantMaterial({ vertexColors: true, sway: { amp: 0.22, speed: 0.9, freq: 0.35 }, key: 'stem', roughness: 0.6 });
  const stemMesh = new THREE.Mesh(stems, stemMat);
  stemMesh.frustumCulled = false;
  group.add(stemMesh);
  const tex = leafTexture({ base: '#e8f4d8', tip: '#ffffff' });
  const geos = {
    round: leafGeometry({ length: 1, width: 0.62, segs: 3, cols: 1, curl: 0.4, fold: 0.3, shape: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.8) }),
    narrow: leafGeometry({ length: 1.4, width: 0.28, segs: 3, cols: 1, curl: 0.5, fold: 0.25 }),
    needle: leafGeometry({ length: 1.3, width: 0.1, segs: 2, cols: 1, curl: 0.4, fold: 0.1 }),
  };
  for (const kind of Object.keys(leafItems)) {
    if (!leafItems[kind].length) continue;
    const mat = plantMaterial({ map: tex, sway: { amp: 0.22, speed: 0.9, freq: 0.35 }, instSway: true, leafSway: 0.02, key: 'stemleaf', roughness: 0.5 });
    group.add(instancedLeaves(geos[kind], mat, leafItems[kind]));
  }
  return group;
}

// ---------------------------------------------------------------------------
// バリスネリア（リボン状の長い葉）
// ---------------------------------------------------------------------------
export function createVallisneria(floor, rng, opts) {
  const geos = [];
  for (let i = 0; i < opts.count; i++) {
    const x = rng.float(opts.x[0], opts.x[1]);
    const z = rng.float(opts.z[0], opts.z[1]);
    const y0 = floor(x, z) - 0.05;
    const H = rng.float(opts.height[0], opts.height[1]);
    const segs = 16;
    const w = rng.float(0.05, 0.08);
    const bendDir = new THREE.Vector3(rng.float(-1, 1) + (opts.lean ?? 0), 0, rng.float(-0.5, 0.5)).normalize();
    const bend = rng.float(0.1, 0.5);
    const twist0 = rng.float(0, Math.PI);
    const pos = [], sway = [], col = [], idx = [];
    const cA = new THREE.Color(opts.colors[0]), cB = new THREE.Color(opts.colors[1]);
    const cc = new THREE.Color();
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = x + bendDir.x * bend * t * t * H * 0.4;
      const cz = z + bendDir.z * bend * t * t * H * 0.4;
      const cy = y0 + t * H * (1 - bend * t * 0.25);
      const tw = twist0 + t * rng.float(0.5, 2);
      const ww = w * (t > 0.9 ? Math.max((1 - t) / 0.1, 0.08) : 1) * (0.7 + 0.3 * Math.min(1, t * 6));
      const dx = Math.cos(tw) * ww, dz = Math.sin(tw) * ww;
      pos.push(cx - dx, cy, cz - dz, cx + dx, cy, cz + dz);
      sway.push(t * H * 0.3, t * H * 0.3);
      cc.copy(cA).lerp(cB, t).multiplyScalar(rng.float(0.9, 1.05));
      col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
    }
    for (let s = 0; s < segs; s++) {
      const a = s * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  const geo = mergeGeometries(geos);
  const mat = plantMaterial({ vertexColors: true, sway: { amp: opts.swayAmp ?? 0.35, speed: 0.7, freq: 0.3 }, key: 'vallis', roughness: 0.55, causticMul: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// ロゼット型（アヌビアス、クリプトコリネ、ミクロソリウム）
// spots: [{ pos, normal }]
// ---------------------------------------------------------------------------
export function createRosettes(rng, spots, opts) {
  const geo = leafGeometry({
    length: 1,
    width: opts.width ?? 0.5,
    segs: 7,
    cols: 2,
    curl: opts.curl ?? 0.6,
    fold: opts.fold ?? 0.25,
    wave: opts.wave ?? 0,
    shape: opts.shape,
  });
  // 葉柄（付け根を細く伸ばす）
  const p = geo.attributes.position;
  const stalk = opts.stalk ?? 0.25;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, stalk + y * (1 - stalk));
    if (y < 0.02) {
      p.setX(i, p.getX(i) * 0.2);
    }
  }
  geo.computeVertexNormals();
  const tex = leafTexture({ base: opts.texBase ?? '#d8ecc8', tip: '#ffffff', vein: opts.vein ?? 'rgba(255,255,230,0.5)', vein2: opts.vein2 });
  const mat = plantMaterial({ map: tex, sway: { amp: opts.swayAmp ?? 0.06, speed: 1.0, freq: 0.5 }, instSway: true, leafSway: 0.4, key: 'rosette-' + opts.key, roughness: opts.roughness ?? 0.4, env: 0.9 });
  const items = [];
  for (const sp of spots) {
    const nLeaves = rng.int(opts.leaves[0], opts.leaves[1]);
    const n = sp.normal ? sp.normal.clone() : new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < nLeaves; k++) {
      const ang = rng.float(0, Math.PI * 2);
      const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const tilt = rng.float(opts.tilt[0], opts.tilt[1]);
      const dir = n.clone().multiplyScalar(Math.cos(tilt)).add(out.multiplyScalar(Math.sin(tilt))).normalize();
      const c = new THREE.Color(rng.pick(opts.colors)).multiplyScalar(rng.float(0.8, 1.1));
      items.push({
        pos: sp.pos.clone().add(new THREE.Vector3(rng.float(-0.04, 0.04), 0, rng.float(-0.04, 0.04))),
        quat: quatFromDir(dir, ang + rng.float(-0.3, 0.3)),
        scale: new THREE.Vector3(1, 1, 1).multiplyScalar(rng.float(opts.size[0], opts.size[1])),
        color: c,
        sway: 0.2,
      });
    }
  }
  const mesh = instancedLeaves(geo, mat, items);
  mesh.castShadow = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// モス（ウィローモス等）：ふわふわの小さな塊
// ---------------------------------------------------------------------------
export function createMoss(rng, spots, opts) {
  // 細い葉を放射状に束ねた「ふわふわ」の房
  const frond = leafGeometry({ length: 1, width: 0.16, segs: 2, cols: 1, curl: 0.6, fold: 0.1, shape: (t) => 1 - t * 0.7 });
  const parts = [];
  const r = new Rng(opts.seed ?? 5);
  for (let k = 0; k < 12; k++) {
    const g = frond.clone();
    const len = r.float(0.5, 1.0);
    g.scale(len, len, len);
    g.rotateX(r.float(0.2, 1.35));
    g.rotateY(r.float(0, Math.PI * 2));
    g.translate(r.float(-0.25, 0.25), r.float(-0.05, 0.1), r.float(-0.25, 0.25));
    parts.push(g);
  }
  const base = mergeGeometries(parts);
  const tex = leafTexture({ base: '#b8d8a0', tip: '#f0ffe0', veins: false, vein: 'rgba(255,255,255,0.15)' });
  const mat = plantMaterial({ map: tex, sway: { amp: 0.05, speed: 1.2, freq: 0.8 }, instSway: true, leafSway: 0.6, key: 'moss', roughness: 0.75, causticMul: 0.8 });
  const items = spots.map((sp) => ({
    pos: sp.pos,
    quat: quatFromDir(sp.normal ?? new THREE.Vector3(0, 1, 0), rng.float(0, 6.28)),
    scale: new THREE.Vector3(1, 1, 1).multiplyScalar(rng.float(opts.size[0], opts.size[1])),
    color: new THREE.Color(rng.pick(opts.colors)).multiplyScalar(rng.float(0.8, 1.1)),
    sway: 0.1,
  }));
  const mesh = instancedLeaves(base, mat, items);
  mesh.receiveShadow = true;
  return mesh;
}

// 表面上の配置点をレイキャストで探す
export function surfaceSpots(targets, rng, count, opts) {
  const ray = new THREE.Raycaster();
  const out = [];
  let guard = 0;
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();
  while (out.length < count && guard++ < count * 30) {
    const c = opts.center(rng);
    if (opts.fromAbove) {
      origin.set(c.x, 30, c.z);
      dir.set(0, -1, 0);
    } else {
      dir.set(rng.float(-1, 1), rng.float(-1, opts.minDirY ?? -0.2), rng.float(-1, 1)).normalize();
      origin.copy(c).addScaledVector(dir, -12);
    }
    ray.set(origin, dir);
    const hits = ray.intersectObjects(targets, false);
    if (!hits.length) continue;
    const h = hits[0];
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (opts.minNormalY != null && n.y < opts.minNormalY) continue;
    if (opts.filter && !opts.filter(h.point, n)) continue;
    out.push({ pos: h.point.clone(), normal: n });
  }
  return out;
}
