import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleCurve } from '../shared.js';

// 魚のローカル座標系:
//   全長 1（x: -0.5 = 尾ビレ先端, +0.5 = 吻端）、+y が背、+z が体の右側
//   胴体は x = xb（尾柄）から 0.5 まで。ヒレは z=0 平面上の「根元線→外縁線」の格子。

export function bodyFunctions(spec) {
  const b = spec.body;
  const xb = b.xb;
  const len = 0.5 - xb;
  const s = (x) => (x - xb) / len;
  const mid = b.mid || null;
  return {
    xb,
    s,
    top: (x) => Math.max(0, sampleCurve(b.top, s(x))) + (mid ? sampleCurve(mid, s(x)) : 0),
    bot: (x) => Math.max(0, sampleCurve(b.bot, s(x))) - (mid ? sampleCurve(mid, s(x)) : 0),
    width: (x) => Math.max(0, sampleCurve(b.width, s(x))) * (b.widthScale ?? 0.82),
    center: (x) => (mid ? sampleCurve(mid, s(x)) : 0),
  };
}

function addFinAttr(geo, dirFn, flexFn) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const d = dirFn(i);
    arr[i * 4] = d.x;
    arr[i * 4 + 1] = d.y;
    arr[i * 4 + 2] = d.z;
    arr[i * 4 + 3] = flexFn(i);
  }
  geo.setAttribute('aFin', new THREE.BufferAttribute(arr, 4));
}

function planarUV(geo, spec, src2D) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const ye = spec.texYExt;
  for (let i = 0; i < pos.count; i++) {
    const x = src2D ? src2D[i * 2] : pos.getX(i);
    const y = src2D ? src2D[i * 2 + 1] : pos.getY(i);
    uv[i * 2] = x + 0.5;
    uv[i * 2 + 1] = (y + ye) / (2 * ye);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------------------
// 胴体
// ---------------------------------------------------------------------------
function buildBody(spec, F) {
  // 小型魚ほど粗く（画面上の大きさに合わせる）
  const big = spec.length > 0.7;
  const NS = big ? 44 : 30; // 長さ方向
  const NA = big ? 24 : 16; // 周方向
  const xb = F.xb;
  const verts = [];
  const xs = [];
  for (let i = 0; i <= NS; i++) {
    // 吻端付近を細かく
    const t = i / NS;
    const u = 1 - Math.pow(1 - t, 1.6);
    xs.push(xb + (0.5 - xb) * u);
  }
  const square = spec.body.square ?? 0; // 0=楕円, >0 で角張った断面
  const keel = spec.body.keel ?? 0.15; // 背側が細くなる度合い
  for (let i = 0; i <= NS; i++) {
    const x = xs[i];
    const tp = F.top(x), bt = F.bot(x), w = F.width(x), c = F.center(x);
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * Math.PI * 2;
      const sn = Math.sin(th), cs = Math.cos(th);
      const ys = sn >= 0 ? c + (tp - c) * sn : c + (bt + c) * sn;
      let zc = cs;
      if (square > 0) zc = Math.sign(cs) * Math.pow(Math.abs(cs), 1 - square * 0.5);
      const narrowing = 1 - keel * Math.max(0, sn) + 0.08 * Math.min(0, sn);
      verts.push(x, i === NS ? c : ys, i === NS ? 0 : w * zc * narrowing);
    }
  }
  // 尾柄キャップ中心
  const capIndex = verts.length / 3;
  verts.push(xb - 0.003, F.center(xb), 0);
  const idx = [];
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * NA + j;
      const b = i * NA + ((j + 1) % NA);
      const c2 = (i + 1) * NA + j;
      const d = (i + 1) * NA + ((j + 1) % NA);
      idx.push(a, c2, b, b, c2, d);
    }
  }
  for (let j = 0; j < NA; j++) idx.push(capIndex, j, (j + 1) % NA);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  planarUV(geo, spec);
  addFinAttr(geo, () => ({ x: 0, y: 0, z: 1 }), () => 0);
  return geo;
}

// ---------------------------------------------------------------------------
// ヒレ（根元線と外縁線の間を格子で張る）
// ---------------------------------------------------------------------------
function spaced(points2D, n, smooth = true) {
  const pts = points2D.map((p) => new THREE.Vector3(p[0], p[1], 0));
  if (pts.length === 2) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(pts[0].clone().lerp(pts[1], i / (n - 1)));
    return out;
  }
  const curve = smooth ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : null;
  if (curve) return curve.getSpacedPoints(n - 1);
  const path = new THREE.CurvePath();
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  return path.getSpacedPoints(n - 1);
}

function finStrip(root, tip, m, flex, flexPow = 1.4) {
  const n = root.length;
  const pos = [];
  const flx = [];
  for (let j = 0; j <= m; j++) {
    const r = j / m;
    for (let i = 0; i < n; i++) {
      const p = root[i].clone().lerp(tip[i], r);
      pos.push(p.x, p.y, 0);
      flx.push(Math.pow(r, flexPow) * flex);
    }
  }
  const idx = [];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) nrm[i + 2] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.userData.flex = flx;
  return geo;
}

function rootAlong(F, edge, x1, x2, inset, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = x1 + (x2 - x1) * (i / (n - 1));
    const y = edge === 'top' ? F.top(x) * (1 - inset) + F.center(x) * inset : -F.bot(x) * (1 - inset) + F.center(x) * inset;
    pts.push(new THREE.Vector3(x, y, 0));
  }
  return pts;
}

function finalizeMedianFin(geo, spec) {
  planarUV(geo, spec);
  const flx = geo.userData.flex;
  addFinAttr(geo, () => ({ x: 0, y: 0, z: 1 }), (i) => flx[i]);
  return geo;
}

function buildFin(spec, F, fin, raysOut) {
  const big = spec.length > 0.7;
  const N = Math.round((fin.n ?? 22) * (big ? 0.85 : 0.6));
  const M = Math.max(3, Math.round((fin.m ?? 7) * (big ? 0.8 : 0.6)));
  const flex = fin.flex ?? 1;
  if (fin.type === 'caudal') {
    const xr = F.xb + (fin.rootIn ?? 0.03);
    const t = F.top(xr) * 0.92, b = F.bot(xr) * 0.92, c = F.center(xr);
    const root = spaced([[xr, c + t], [xr, c - b]], N);
    const tip = spaced(fin.tip, N, fin.smooth !== false);
    raysOut.push({ root, tip, rays: fin.rays ?? true });
    return [finalizeMedianFin(finStrip(root, tip, M, flex, fin.flexPow ?? 1.2), spec)];
  }
  if (fin.type === 'dorsal' || fin.type === 'anal' || fin.type === 'adipose') {
    const edge = fin.type === 'anal' ? 'bot' : 'top';
    const root = rootAlong(F, edge, fin.x1, fin.x2, fin.inset ?? 0.12, N);
    const tip = spaced(fin.tip, N, fin.smooth !== false);
    raysOut.push({ root, tip, rays: fin.rays ?? fin.type !== 'adipose' });
    return [finalizeMedianFin(finStrip(root, tip, M, flex, fin.flexPow ?? 1.5), spec)];
  }
  if (fin.type === 'pectoral' || fin.type === 'pelvic') {
    // 2D で作ってから体側へ回転配置（左右ペア）
    const ax = fin.x, ay = fin.y;
    const root = spaced(fin.root ?? [[ax, ay + (fin.rootH ?? 0.02)], [ax, ay - (fin.rootH ?? 0.02)]], N);
    const tip = spaced(fin.tip, N, fin.smooth !== false);
    raysOut.push({ root, tip, rays: fin.rays ?? true });
    const out = [];
    for (const side of [1, -1]) {
      const g = finStrip(root, tip, M, flex, fin.flexPow ?? 1.2);
      const src2D = new Float32Array((g.attributes.position.count) * 2);
      for (let i = 0; i < g.attributes.position.count; i++) {
        src2D[i * 2] = g.attributes.position.getX(i);
        src2D[i * 2 + 1] = g.attributes.position.getY(i);
      }
      const m = new THREE.Matrix4();
      const rot = new THREE.Matrix4();
      if (fin.type === 'pectoral') {
        rot.makeRotationY(side * (fin.angle ?? 0.6));
        if (fin.tilt) rot.premultiply(new THREE.Matrix4().makeRotationX(side * fin.tilt));
      } else {
        rot.makeRotationX(-side * (fin.angle ?? 0.35));
        if (fin.yaw) rot.premultiply(new THREE.Matrix4().makeRotationY(side * fin.yaw));
      }
      const zOff = (fin.z ?? F.width(ax) * 0.9) * side;
      m.makeTranslation(ax, ay, zOff).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-ax, -ay, 0));
      g.applyMatrix4(m);
      const dir = new THREE.Vector3(0, 0, 1).applyMatrix4(rot).normalize();
      const flx = g.userData.flex;
      planarUV(g, spec, src2D);
      addFinAttr(g, () => dir, (i) => flx[i]);
      out.push(g);
    }
    return out;
  }
  return [];
}

// ---------------------------------------------------------------------------
// 目
// ---------------------------------------------------------------------------
function buildEyes(spec, F) {
  const e = spec.eye;
  const out = [];
  for (const side of [1, -1]) {
    const g = new THREE.SphereGeometry(e.r * 0.82, 14, 10);
    g.rotateX(side * Math.PI / 2);
    g.scale(1, 1, 0.75);
    const z = (F.width(e.x) * (e.inset ?? 0.86)) * side;
    g.translate(e.x, e.y, z);
    addFinAttr(g, () => ({ x: 0, y: 0, z: 1 }), () => 0);
    out.push(g);
  }
  return out;
}

export function buildFishGeometry(spec) {
  const F = bodyFunctions(spec);
  const body = buildBody(spec, F);
  const rays = [];
  const fins = [];
  for (const fin of spec.fins) fins.push(...buildFin(spec, F, fin, rays));
  const eyes = buildEyes(spec, F);
  // 目の UV は球の UV をそのまま使う
  const finGeo = mergeGeometries(fins.map((g) => stripTo(g)), false);
  const eyeGeo = mergeGeometries(eyes.map((g) => stripTo(g)), false);
  const geometry = mergeGeometries([stripTo(body), finGeo, eyeGeo], true);
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius = 0.75;
  return { geometry, rays, F };
}

function stripTo(g) {
  const keep = ['position', 'normal', 'uv', 'aFin'];
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  if (!g.index) {
    const idx = [];
    for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
    g.setIndex(idx);
  }
  return g;
}
