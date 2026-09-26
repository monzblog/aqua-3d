import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, Rng, lerp, clamp, smoothstep, createNoise3D, fbm3 } from './shared.js';
import { instancedLeaves } from './plants.js';

// 蛍光（アクチニック光で光る）を頂点色から足すマテリアル
function coralMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.55,
    metalness: 0,
    envMapIntensity: 0.6,
    side: opts.side ?? THREE.FrontSide,
    color: opts.color ?? '#ffffff',
  });
  const fluo = (opts.fluo ?? 0.35).toFixed(3);
  patchMaterial(mat, {
    caustics: true,
    causticMul: opts.causticMul ?? 0.8,
    sway: opts.sway,
    key: 'coral-' + (opts.key ?? ''),
    extraVertex: opts.instSway
      ? (vs) =>
          vs
            .replace('attribute float aSway;', 'attribute float aSway;\nattribute float aSwayI;')
            .replace('float h = aSway;', `float h = aSwayI + aSway;`)
      : null,
    extraFragment: (fs) =>
      fs.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          totalEmissiveRadiance += vColor.rgb * vColor.rgb * ${fluo} * 1.6;
        #endif`
      ),
  });
  return mat;
}

function tube(points, r0, r1, radial, colorFn) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(4, Math.round(curve.getLength() * 14));
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const center = curve.getPointAt(t);
    const r = lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      tmp.fromBufferAttribute(nrm, k);
      pos.setXYZ(k, center.x + tmp.x * r, center.y + tmp.y * r, center.z + tmp.z * r);
      colorFn(t, c);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  // 先端キャップ（丸い）
  const cap = new THREE.SphereGeometry(r1 * 1.15, 6, 4);
  cap.translate(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].z);
  cap.deleteAttribute('uv');
  const cc = new Float32Array(cap.attributes.position.count * 3);
  colorFn(1, c);
  for (let i = 0; i < cc.length; i += 3) {
    cc[i] = c.r * 1.2;
    cc[i + 1] = c.g * 1.2;
    cc[i + 2] = c.b * 1.2;
  }
  cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return [g, cap];
}

// ---------------------------------------------------------------------------
// 枝状ミドリイシ（Acropora）
// ---------------------------------------------------------------------------
export function createAcropora(rng, opts) {
  const geos = [];
  const base = new THREE.Color(opts.base), tip = new THREE.Color(opts.tip);
  const grow = (p, dir, len, r, depth) => {
    const pts = [p.clone()];
    const d = dir.clone();
    let q = p.clone();
    for (let i = 0; i < 3; i++) {
      d.x += rng.float(-0.25, 0.25);
      d.z += rng.float(-0.25, 0.25);
      d.y += 0.12;
      d.normalize();
      q = q.clone().addScaledVector(d, len / 3);
      pts.push(q);
    }
    const r1 = depth === 0 ? r * 0.55 : r * 0.75;
    const tip0 = depth === 0;
    geos.push(
      ...tube(pts, r, r1, 6, (t, c) => {
        c.copy(base).lerp(tip, tip0 ? smoothstep(0.2, 1, t) : 0.15 * t);
      })
    );
    if (depth === 0) return;
    const kids = rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      const t = rng.float(0.5, 1);
      const cp = new THREE.CatmullRomCurve3(pts).getPointAt(t);
      const nd = d.clone().add(new THREE.Vector3(rng.float(-0.9, 0.9), rng.float(0, 0.5), rng.float(-0.9, 0.9))).normalize();
      grow(cp, nd, len * rng.float(0.6, 0.85), r1 * 0.9, depth - 1);
    }
  };
  for (let i = 0; i < (opts.trunks ?? 5); i++) {
    const a = (i / (opts.trunks ?? 5)) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const dir = new THREE.Vector3(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6).normalize();
    grow(new THREE.Vector3(0, 0, 0), dir, opts.size * 0.45, opts.size * 0.06, opts.depth ?? 3);
  }
  const geo = mergeGeometries(geos);
  const mat = coralMaterial({ fluo: opts.fluo ?? 0.5, key: 'acro', roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// テーブルサンゴ
// ---------------------------------------------------------------------------
export function createTableCoral(rng, opts) {
  const noise = createNoise3D(opts.seed ?? 3);
  const R = opts.radius;
  const g = new THREE.CircleGeometry(R, 72, 0, Math.PI * 2);
  const pos0 = g.attributes.position;
  // 細分化のため RingGeometry を使う
  const ring = new THREE.RingGeometry(0.02, R, 96, 18);
  ring.rotateX(-Math.PI / 2);
  const pos = ring.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const cIn = new THREE.Color(opts.inner), cOut = new THREE.Color(opts.outer), cRim = new THREE.Color(opts.rim);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z) / R;
    const a = Math.atan2(z, x);
    const edge = 1 + fbm3(noise, Math.cos(a) * 2, Math.sin(a) * 2, 0, 3) * 0.18;
    const rr = r * edge;
    const y = -rr * rr * 0.12 * R + Math.sin(a * 40) * 0.006 * r + fbm3(noise, x * 3, 0, z * 3, 2) * 0.03;
    pos.setXYZ(i, x * edge, y, z * edge);
    c.copy(cIn).lerp(cOut, smoothstep(0.1, 0.8, r)).lerp(cRim, smoothstep(0.85, 1, r));
    const ridge = 0.5 + 0.5 * Math.sin(a * 60 + fbm3(noise, x * 4, 1, z * 4, 2) * 6);
    c.multiplyScalar(0.8 + ridge * 0.3);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  ring.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ring.deleteAttribute('uv');
  ring.computeVertexNormals();
  // 下面（厚み）
  const under = ring.clone();
  under.scale(1, 1, 1);
  under.translate(0, -0.03, 0);
  const idx = under.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i];
    idx[i] = idx[i + 2];
    idx[i + 2] = t;
  }
  const uc = under.attributes.color;
  for (let i = 0; i < uc.count; i++) uc.setXYZ(i, uc.getX(i) * 0.4, uc.getY(i) * 0.4, uc.getZ(i) * 0.45);
  under.computeVertexNormals();
  const stalk = new THREE.CylinderGeometry(R * 0.08, R * 0.14, opts.stalk ?? 0.4, 10);
  stalk.translate(0, -(opts.stalk ?? 0.4) / 2, 0);
  stalk.deleteAttribute('uv');
  const sc = new Float32Array(stalk.attributes.position.count * 3);
  const s0 = new THREE.Color(opts.inner).multiplyScalar(0.5);
  for (let i = 0; i < sc.length; i += 3) {
    sc[i] = s0.r;
    sc[i + 1] = s0.g;
    sc[i + 2] = s0.b;
  }
  stalk.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const geo = mergeGeometries([ring, under, stalk]);
  const mat = coralMaterial({ fluo: opts.fluo ?? 0.45, key: 'table', roughness: 0.65 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.dispose();
  void pos0;
  return mesh;
}

// ---------------------------------------------------------------------------
// ノウサンゴ（Platygyra / Lobophyllia 風の迷路模様）
// ---------------------------------------------------------------------------
export function createBrainCoral(rng, opts) {
  const noise = createNoise3D(opts.seed ?? 11);
  let geo = new THREE.IcosahedronGeometry(1, 5);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const cR = new THREE.Color(opts.ridge), cV = new THREE.Color(opts.valley), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = fbm3(noise, v.x * 3.2, v.y * 3.2, v.z * 3.2, 2);
    const maze = Math.abs(Math.sin(n * 22));
    const ridge = smoothstep(0.25, 0.9, maze);
    let r = 1 + ridge * 0.05 + fbm3(noise, v.x, v.y, v.z, 2) * 0.12;
    let y = v.y;
    if (y < -0.1) y = -0.1 + (y + 0.1) * 0.2;
    pos.setXYZ(i, v.x * r, y * r * (opts.flat ?? 0.75), v.z * r);
    c.copy(cV).lerp(cR, ridge);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.scale(opts.size, opts.size, opts.size);
  const mat = coralMaterial({ fluo: opts.fluo ?? 0.55, key: 'brain', roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// 触手（イソギンチャク、ハナサンゴ）
// ---------------------------------------------------------------------------
function tentacleGeometry(opts) {
  const len = 1;
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(Math.sin(t * 1.2) * (opts.curve ?? 0.15), t * len, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = 10, radial = 6;
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const sway = new Float32Array(pos.count);
  const col = new Float32Array(pos.count * 3);
  const cB = new THREE.Color(opts.base), cT = new THREE.Color(opts.tip), c = new THREE.Color();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const center = curve.getPointAt(t);
    // バブルチップ：先端手前で膨らむ
    let r = lerp(opts.r0 ?? 0.06, opts.r1 ?? 0.03, t);
    if (opts.bulb) r *= 1 + Math.exp(-Math.pow((t - 0.78) / 0.12, 2)) * opts.bulb;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      n.fromBufferAttribute(nrm, k);
      pos.setXYZ(k, center.x + n.x * r, center.y + n.y * r, center.z + n.z * r);
      sway[k] = t * t;
      c.copy(cB).lerp(cT, smoothstep(opts.tipStart ?? 0.55, 1, t));
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  // 先端の丸み
  const tipPt = curve.getPointAt(1);
  const cap = new THREE.SphereGeometry(opts.r1 ?? 0.03, 6, 4);
  cap.translate(tipPt.x, tipPt.y, tipPt.z);
  cap.deleteAttribute('uv');
  const cs = new Float32Array(cap.attributes.position.count).fill(1);
  const cc = new Float32Array(cap.attributes.position.count * 3);
  for (let i = 0; i < cc.length; i += 3) {
    cc[i] = cT.r;
    cc[i + 1] = cT.g;
    cc[i + 2] = cT.b;
  }
  cap.setAttribute('aSway', new THREE.BufferAttribute(cs, 1));
  cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return mergeGeometries([g, cap]);
}

export function createAnemone(rng, opts) {
  const group = new THREE.Group();
  const tent = tentacleGeometry({ base: opts.base, tip: opts.tip, bulb: opts.bulb ?? 1.2, r0: 0.05, r1: 0.022, curve: 0.2, tipStart: 0.35 });
  const mat = coralMaterial({ fluo: opts.fluo ?? 0.6, sway: { amp: opts.swayAmp ?? 0.35, speed: 1.3, freq: 1.2 }, instSway: true, key: 'anem', roughness: 0.35, side: THREE.DoubleSide });
  const items = [];
  const n = opts.count ?? 160;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996;
    const rr = Math.sqrt(i / n) * opts.radius;
    const p = new THREE.Vector3(Math.cos(a) * rr, 0.02 + (1 - rr / opts.radius) * 0.05, Math.sin(a) * rr);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const dir = new THREE.Vector3(0, 1, 0).addScaledVector(out, 0.35 + (rr / opts.radius) * 1.1).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.float(0, 6.28)));
    const c = new THREE.Color(1, 1, 1).multiplyScalar(rng.float(0.85, 1.1));
    items.push({ pos: p, quat: q, scale: new THREE.Vector3(1, 1, 1).multiplyScalar(opts.length * rng.float(0.75, 1.15)), color: c, sway: 0 });
  }
  const mesh = instancedLeaves(tent, mat, items);
  group.add(mesh);
  // 口盤
  const disc = new THREE.CylinderGeometry(opts.radius * 0.9, opts.radius * 0.6, 0.12, 24);
  disc.deleteAttribute('uv');
  const dc = new Float32Array(disc.attributes.position.count * 3);
  const d0 = new THREE.Color(opts.disc ?? opts.base);
  for (let i = 0; i < dc.length; i += 3) {
    dc[i] = d0.r;
    dc[i + 1] = d0.g;
    dc[i + 2] = d0.b;
  }
  disc.setAttribute('color', new THREE.BufferAttribute(dc, 3));
  const dm = new THREE.Mesh(disc, coralMaterial({ fluo: 0.3, key: 'disc' }));
  dm.position.y = -0.03;
  group.add(dm);
  return group;
}

// ハナサンゴ（Euphyllia：トーチ／ハンマー）
export function createEuphyllia(rng, opts) {
  const group = new THREE.Group();
  const heads = opts.heads ?? 5;
  const tent = tentacleGeometry({ base: opts.base, tip: opts.tip, r0: 0.045, r1: opts.hammer ? 0.05 : 0.03, curve: 0.25, tipStart: 0.8, bulb: opts.hammer ? 0.6 : 0 });
  const mat = coralMaterial({ fluo: opts.fluo ?? 0.7, sway: { amp: 0.28, speed: 1.1, freq: 1.4 }, instSway: true, key: 'euph', roughness: 0.35, side: THREE.DoubleSide });
  const items = [];
  const skel = [];
  for (let h = 0; h < heads; h++) {
    const a = (h / heads) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const hr = rng.float(0.1, 0.35) * opts.size;
    const hc = new THREE.Vector3(Math.cos(a) * hr, rng.float(0.15, 0.4) * opts.size, Math.sin(a) * hr);
    const sk = new THREE.CylinderGeometry(0.12 * opts.size, 0.08 * opts.size, hc.y, 8);
    sk.translate(hc.x, hc.y / 2, hc.z);
    sk.deleteAttribute('uv');
    skel.push(sk);
    for (let i = 0; i < (opts.perHead ?? 34); i++) {
      const aa = rng.float(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * 0.14 * opts.size;
      const p = hc.clone().add(new THREE.Vector3(Math.cos(aa) * rr, 0, Math.sin(aa) * rr));
      const dir = new THREE.Vector3(Math.cos(aa) * rng.float(0.3, 1.2), 1, Math.sin(aa) * rng.float(0.3, 1.2)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      items.push({ pos: p, quat: q, scale: opts.size * rng.float(0.3, 0.5), color: new THREE.Color(1, 1, 1).multiplyScalar(rng.float(0.85, 1.1)), sway: 0 });
    }
  }
  group.add(instancedLeaves(tent, mat, items));
  const sg = mergeGeometries(skel);
  const sc = new Float32Array(sg.attributes.position.count * 3);
  for (let i = 0; i < sc.length; i += 3) {
    sc[i] = 0.35;
    sc[i + 1] = 0.3;
    sc[i + 2] = 0.26;
  }
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  group.add(new THREE.Mesh(sg, coralMaterial({ fluo: 0, key: 'skel' })));
  return group;
}

// ---------------------------------------------------------------------------
// ポリプ系（マメスナギンチャク、ディスクコーラル）を岩肌に
// ---------------------------------------------------------------------------
export function createZoanthids(rng, spots, opts) {
  const polyp = new THREE.CylinderGeometry(0.035, 0.03, 0.05, 10, 1, false);
  polyp.translate(0, 0.025, 0);
  const disc = new THREE.CircleGeometry(0.05, 14);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, 0.052, 0);
  // 中心を明るく
  const g = mergeGeometries([polyp.toNonIndexed(), disc.toNonIndexed()]);
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sw = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const top = pos.getY(i) > 0.05;
    const v = top ? (r < 0.018 ? 1.3 : r < 0.04 ? 0.55 : 1.0) : 0.35;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    sw[i] = pos.getY(i) * 2;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  g.computeVertexNormals();
  const mat = coralMaterial({ fluo: 0.45, sway: { amp: 0.05, speed: 1.5, freq: 2 }, instSway: true, key: 'zoa', roughness: 0.4 });
  const items = [];
  for (const sp of spots) {
    const colony = rng.pick(opts.palettes);
    const n = rng.int(opts.perColony[0], opts.perColony[1]);
    const tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(sp.normal.x) > 0.9) tangent.set(0, 0, 1);
    const bt = new THREE.Vector3().crossVectors(sp.normal, tangent).normalize();
    tangent.crossVectors(bt, sp.normal).normalize();
    for (let k = 0; k < n; k++) {
      const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * opts.radius;
      const p = sp.pos.clone().addScaledVector(tangent, Math.cos(a) * rr).addScaledVector(bt, Math.sin(a) * rr);
      const dir = sp.normal.clone().add(new THREE.Vector3(rng.float(-0.3, 0.3), rng.float(-0.3, 0.3), rng.float(-0.3, 0.3))).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      items.push({ pos: p, quat: q, scale: rng.float(0.8, 1.3) * (opts.scale ?? 1), color: new THREE.Color(rng.pick(colony)), sway: 0 });
    }
  }
  return instancedLeaves(g, mat, items);
}

export function createMushrooms(rng, spots, opts) {
  const g = new THREE.CircleGeometry(0.16, 24, 0, Math.PI * 2);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sw = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z) / 0.16;
    const a = Math.atan2(z, x);
    pos.setY(i, 0.05 * (1 - r * r) + Math.sin(a * 7) * 0.012 * r);
    const spot = (Math.sin(x * 90) * Math.sin(z * 90) > 0.6 ? 1.3 : 1) * (r < 0.15 ? 1.4 : 1);
    const v = (0.65 + r * 0.35) * spot;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    sw[i] = r * 0.3;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const mat = coralMaterial({ fluo: 0.6, sway: { amp: 0.04, speed: 1.2, freq: 1.5 }, instSway: true, key: 'mush', roughness: 0.3, side: THREE.DoubleSide });
  const items = [];
  for (const sp of spots) {
    const c = new THREE.Color(rng.pick(opts.colors));
    const n = rng.int(2, 5);
    for (let k = 0; k < n; k++) {
      const p = sp.pos.clone().add(new THREE.Vector3(rng.float(-0.2, 0.2), rng.float(-0.05, 0.05), rng.float(-0.2, 0.2)));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sp.normal.clone().add(new THREE.Vector3(rng.float(-0.4, 0.4), 0.3, rng.float(-0.4, 0.4))).normalize());
      items.push({ pos: p, quat: q, scale: rng.float(0.7, 1.4), color: c.clone().multiplyScalar(rng.float(0.85, 1.1)), sway: 0 });
    }
  }
  return instancedLeaves(g, mat, items);
}

// ---------------------------------------------------------------------------
// ヤギ（ウミウチワ）：平面上に枝分かれ
// ---------------------------------------------------------------------------
export function createSeaFan(rng, opts) {
  const geos = [];
  const c0 = new THREE.Color(opts.color);
  const grow = (p, ang, len, r, depth) => {
    const pts = [p.clone()];
    let q = p.clone();
    let a = ang;
    for (let i = 0; i < 3; i++) {
      a += rng.float(-0.2, 0.2);
      q = q.clone().add(new THREE.Vector3(Math.sin(a) * len / 3, Math.cos(a) * len / 3, rng.float(-0.02, 0.02)));
      pts.push(q);
    }
    geos.push(...tube(pts, r, r * 0.7, 4, (t, c) => c.copy(c0).multiplyScalar(0.8 + t * 0.3)));
    if (depth === 0) return;
    const kids = 2;
    for (let k = 0; k < kids; k++) {
      const cp = pts[rng.int(1, 3)];
      grow(cp, a + (k === 0 ? -1 : 1) * rng.float(0.3, 0.7), len * rng.float(0.65, 0.85), r * 0.75, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, 0, 0), 0, opts.size * 0.35, opts.size * 0.025, opts.depth ?? 5);
  const geo = mergeGeometries(geos);
  const pos = geo.attributes.position;
  const sw = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sw[i] = Math.max(0, pos.getY(i)) / opts.size;
  geo.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  const mat = coralMaterial({ fluo: 0.35, sway: { amp: 0.25, speed: 0.8, freq: 0.4 }, key: 'fan', roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// ウミキノコ（Sarcophyton）
export function createLeather(rng, opts) {
  const noise = createNoise3D(opts.seed ?? 21);
  const pts = [];
  const H = opts.size;
  pts.push(new THREE.Vector2(0.18 * H, 0));
  pts.push(new THREE.Vector2(0.14 * H, 0.35 * H));
  pts.push(new THREE.Vector2(0.16 * H, 0.6 * H));
  pts.push(new THREE.Vector2(0.45 * H, 0.72 * H));
  pts.push(new THREE.Vector2(0.62 * H, 0.74 * H));
  pts.push(new THREE.Vector2(0.64 * H, 0.78 * H));
  pts.push(new THREE.Vector2(0.4 * H, 0.84 * H));
  pts.push(new THREE.Vector2(0.0, 0.86 * H));
  const g = new THREE.LatheGeometry(pts, 48);
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sw = new Float32Array(pos.count);
  const cS = new THREE.Color(opts.stalk), cC = new THREE.Color(opts.cap), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const wav = Math.sin(a * 6 + fbm3(noise, x, 0, z, 2) * 3) * 0.06 * H * smoothstep(0.3 * H, 0.64 * H, r);
    pos.setY(i, y + wav);
    const t = smoothstep(0.55 * H, 0.75 * H, y);
    c.copy(cS).lerp(cC, t);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    sw[i] = (y / H) * 0.4;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  g.computeVertexNormals();
  const mat = coralMaterial({ fluo: 0.3, sway: { amp: 0.06, speed: 0.6, freq: 0.5 }, key: 'leather', roughness: 0.8, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  return mesh;
}
