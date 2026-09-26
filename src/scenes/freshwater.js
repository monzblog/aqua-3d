import * as THREE from 'three';
import { createNoise3D, fbm3, Rng, clamp, smoothstep, lerp } from '../shared.js';
import { createBackdrop, createSurface, createLightRays, createParticles, createBubbles, createSubstrate, createPebbles } from '../env.js';
import { createRock, createDriftwood } from '../hardscape.js';
import { createCarpet, createGrassTufts, createStemPlants, createVallisneria, createRosettes, createMoss, surfaceSpots } from '../plants.js';
import { FRESH_SPECIES } from '../fish/speciesFresh.js';

export const FRESH_CONFIG = {
  surfaceY: 8.2,
  focusX: -1.4,
  portrait: { hv: 9.8, camY: 4.4, lookY: 3.5 },
  fog: { color: '#3f8e9e', density: 0.036 },
  sun: { color: '#fff2d6', intensity: 3.9, pos: [-7, 24, 9] },
  hemi: { sky: '#cdeeff', ground: '#3a3020', intensity: 0.5 },
  env: { top: '#e8fbff', mid: '#6cc0d0', bottom: '#2a3a28' },
  caustic: { strength: 1.35, color: '#fffbe8' },
  exposure: 1.02,
  bloom: { strength: 0.32, radius: 0.55, threshold: 0.82 },
  species: FRESH_SPECIES,
};

export function buildFreshwater(quality) {
  const group = new THREE.Group();
  const rng = new Rng(2024);
  const noise = createNoise3D(21);
  const S = FRESH_CONFIG.surfaceY;

  // ---------------- 底床の形 ----------------
  const pathCX = (z) => 0.55 + Math.sin(z * 0.45 + 0.6) * 0.55;
  const pathHW = (z) => lerp(0.3, 1.25, smoothstep(-3, 4.5, z));
  const pathMask = (x, z) => {
    if (z < -3.2) return 0;
    const d = Math.abs(x - pathCX(z));
    const w = pathHW(z) * (1 + fbm3(noise, x * 0.8, 3, z * 0.8, 2) * 0.35);
    return smoothstep(w, w * 0.55, d) * smoothstep(-3.2, -2.2, z);
  };
  const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
  const floor = (x, z) => {
    let h = 0.28 + clamp(4.5 - z, 0, 13) * 0.19;
    h += gauss(x, z, -3.0, -0.8, 2.6) * 0.75;
    h += gauss(x, z, 3.8, -1.8, 2.4) * 0.55;
    h += gauss(x, z, -8, -3, 3) * 0.4 + gauss(x, z, 8.5, -3, 3) * 0.4;
    h += fbm3(noise, x * 0.35, 0, z * 0.35, 3) * 0.14;
    h -= pathMask(x, z) * 0.12;
    return h;
  };

  // ---------------- 石組み（青龍石） ----------------
  const stonePal = { dark: '#34393e', base: '#7a8388', light: '#cfd3d2', moss: '#4a6a2a' };
  const stoneDefs = [
    { p: [-3.0, -0.85], s: [1.15, 2.7, 0.95], r: [0.04, 0.6, -0.14], seed: 11, taper: 0.45 },
    { p: [-1.35, 0.15], s: [0.85, 1.55, 0.72], r: [0.0, 1.3, 0.18], seed: 12, taper: 0.4 },
    { p: [-4.7, 0.3], s: [0.75, 1.15, 0.65], r: [0.05, 2.1, -0.2], seed: 13, taper: 0.35 },
    { p: [-2.2, 1.35], s: [0.48, 0.55, 0.42], r: [0.1, 0.4, 0.1], seed: 14 },
    { p: [-0.35, 1.7], s: [0.3, 0.32, 0.28], r: [0, 2.0, 0], seed: 15 },
    { p: [2.05, 1.0], s: [0.55, 0.72, 0.5], r: [0.1, 0.9, 0.12], seed: 16 },
    { p: [3.3, 2.1], s: [0.32, 0.36, 0.3], r: [0.1, 0.2, -0.1], seed: 17 },
    { p: [-6.2, -1.7], s: [0.95, 1.7, 0.8], r: [0.0, 0.3, 0.12], seed: 18, taper: 0.4 },
    { p: [6.1, -0.9], s: [0.8, 1.2, 0.72], r: [0.0, 1.7, -0.12], seed: 19, taper: 0.35 },
    { p: [-5.4, 1.9], s: [0.35, 0.3, 0.32], r: [0.0, 1.0, 0], seed: 20 },
    { p: [4.9, 1.2], s: [0.42, 0.45, 0.38], r: [0.0, 2.6, 0], seed: 22 },
  ];
  const inRock = (x, z, grow = 1) =>
    stoneDefs.some((d) => ((x - d.p[0]) / (d.s[0] * 1.05 * grow)) ** 2 + ((z - d.p[1]) / (d.s[2] * 1.05 * grow)) ** 2 < 1);
  const carpetDensity = (x, z) => {
    if (inRock(x, z, 0.95)) return 0;
    const pm = pathMask(x, z);
    if (pm > 0.35) return 0;
    return (1 - pm * 2.2) * smoothstep(-5.2, -2.6, z) * (0.75 + 0.25 * fbm3(noise, x, 5, z, 2));
  };

  const soilA = new THREE.Color('#3a2a1e'), soilB = new THREE.Color('#5a4230'), sand = new THREE.Color('#e0cfa6'), sandB = new THREE.Color('#bfa77e');
  const moss = new THREE.Color('#2f5a1a'), mossB = new THREE.Color('#4a7a22');
  const substrate = createSubstrate(
    floor,
    (x, z, h, c) => {
      const n = fbm3(noise, x * 1.3, 7, z * 1.3, 3);
      c.copy(soilA).lerp(soilB, clamp(n + 0.5, 0, 1));
      const pm = pathMask(x, z);
      if (pm > 0) c.lerp(sand.clone().lerp(sandB, clamp(n * 1.5 + 0.5, 0, 1)), pm);
      // 絨毯の下は緑の茂み（隙間が土に見えないように）
      const cd = carpetDensity(x, z);
      if (cd > 0) c.lerp(moss.clone().lerp(mossB, clamp(n + 0.5, 0, 1)), clamp(cd * 1.3, 0, 0.92));
    },
    { seed: 5, bump: 1.4, brightness: 1.7 }
  );
  group.add(substrate);

  // 砂の小道の化粧石
  group.add(
    createPebbles(floor, rng, {
      count: quality.low ? 260 : 520,
      x: [-4, 5],
      z: [-3, 5],
      size: [0.03, 0.08],
      colors: ['#cfc0a0', '#a89878', '#e8dcc0', '#8a7c68'],
      mask: (x, z, r) => {
        const pm = pathMask(x, z);
        return pm > 0.05 && pm < 0.95 ? r.next() < 0.9 : pm >= 0.95 ? r.next() < 0.12 : false;
      },
    })
  );

  const rocks = [];
  for (const d of stoneDefs) {
    const y = floor(d.p[0], d.p[1]) + d.s[1] * 0.28;
    const rock = createRock({
      seed: d.seed,
      style: 'seiryu',
      detail: quality.low ? 4 : 5,
      scale: d.s,
      taper: d.taper ?? 0.25,
      position: new THREE.Vector3(d.p[0], y, d.p[1]),
      rotation: d.r,
      palette: stonePal,
    });
    rocks.push(rock);
    group.add(rock);
  }

  // ---------------- 流木 ----------------
  const fy = (x, z) => floor(x, z) - 0.1;
  const wood = createDriftwood({
    seed: 33,
    lift: 0.04,
    palette: { dark: '#2e2016', base: '#6e5038', light: '#a8896a' },
    roots: [
      { start: new THREE.Vector3(3.3, fy(3.3, -1.3), -1.3), dir: new THREE.Vector3(-0.55, 1, -0.15), len: 4.4, r: 0.24, depth: 3 },
      { start: new THREE.Vector3(4.3, fy(4.3, -0.7), -0.7), dir: new THREE.Vector3(0.35, 1, 0.05), len: 3.8, r: 0.19, depth: 3 },
      { start: new THREE.Vector3(2.7, fy(2.7, -2.3), -2.3), dir: new THREE.Vector3(-1, 0.75, -0.3), len: 3.4, r: 0.16, depth: 2 },
      { start: new THREE.Vector3(3.6, fy(3.6, -0.4) + 0.05, -0.4), dir: new THREE.Vector3(1, 0.18, 0.3), len: 2.6, r: 0.14, depth: 2 },
      { start: new THREE.Vector3(3.0, fy(3.0, -0.9), -0.9), dir: new THREE.Vector3(-1, 0.3, 0.5), len: 2.0, r: 0.12, depth: 1 },
    ],
  });
  group.add(wood);

  // ---------------- 水草 ----------------
  const bushes = [
    { x: -11.2, z: -4.1, radius: 1.6, count: 44, height: [5.2, 6.8], leaf: 'narrow', colors: { base: '#2f6424', mid: '#5e9a34', top: '#b0d458' }, leafSize: 0.16, lean: 0.1 },
    { x: -8.8, z: -4.4, radius: 1.5, count: 50, height: [4.4, 6.0], leaf: 'round', colors: { base: '#3f7a28', mid: '#88b440', top: '#f0a0a8' }, leafSize: 0.12, whorl: 2 },
    { x: -6.5, z: -4.7, radius: 1.3, count: 48, height: [3.4, 4.6], leaf: 'needle', colors: { base: '#2f6a28', mid: '#5aa040', top: '#a8e070' }, leafSize: 0.14, whorl: 4, nodeDensity: 18 },
    { x: -4.3, z: -5.0, radius: 1.2, count: 40, height: [2.6, 3.6], leaf: 'round', colors: { base: '#4a7a2c', mid: '#9ab848', top: '#e8d070' }, leafSize: 0.11 },
    { x: -1.9, z: -5.2, radius: 1.25, count: 36, height: [1.9, 2.8], leaf: 'needle', colors: { base: '#3a6a2a', mid: '#78b050', top: '#d8f080' }, leafSize: 0.12, whorl: 4, nodeDensity: 18 },
    { x: 0.7, z: -5.3, radius: 1.1, count: 34, height: [1.6, 2.4], leaf: 'round', colors: { base: '#4a7a30', mid: '#b09048', top: '#ff9a88' }, leafSize: 0.1 },
    { x: 2.8, z: -5.1, radius: 1.2, count: 38, height: [2.4, 3.4], leaf: 'round', colors: { base: '#5a4a28', mid: '#a84a2a', top: '#e8402a' }, leafSize: 0.14, whorl: 2 },
    { x: 5.0, z: -4.8, radius: 1.4, count: 46, height: [3.6, 5.0], leaf: 'needle', colors: { base: '#4a7030', mid: '#c06a48', top: '#ff8468' }, leafSize: 0.14, whorl: 4, nodeDensity: 18 },
    { x: 7.4, z: -4.5, radius: 1.5, count: 48, height: [4.6, 6.2], leaf: 'narrow', colors: { base: '#2f6424', mid: '#5a9a30', top: '#a8d050' }, leafSize: 0.16 },
    { x: 9.8, z: -4.2, radius: 1.6, count: 50, height: [5.0, 6.8], leaf: 'round', colors: { base: '#3f6a26', mid: '#b05a3a', top: '#ff5a48' }, leafSize: 0.13 },
    { x: 12.0, z: -3.9, radius: 1.4, count: 40, height: [5.4, 7.0], leaf: 'needle', colors: { base: '#2f6a28', mid: '#6ab040', top: '#c0f080' }, leafSize: 0.15, whorl: 4, nodeDensity: 16 },
    // 奥の中央：低い前景草で土を隠す（U字構図の谷）
    { x: -3.0, z: -3.9, radius: 1.4, sx: 1.6, count: 30, height: [0.7, 1.3], leaf: 'round', colors: { base: '#3f7a28', mid: '#6aa838', top: '#b8e060' }, leafSize: 0.1 },
    { x: 1.2, z: -4.1, radius: 1.4, sx: 1.6, count: 30, height: [0.6, 1.2], leaf: 'round', colors: { base: '#3f7a28', mid: '#78b040', top: '#d0e870' }, leafSize: 0.1 },
    { x: 4.6, z: -3.6, radius: 1.0, sx: 1.4, count: 20, height: [0.8, 1.5], leaf: 'needle', colors: { base: '#3a6a2a', mid: '#8ab050', top: '#f09080' }, leafSize: 0.12, whorl: 4, nodeDensity: 18 },
    // 中景のアクセント
    { x: -7.6, z: -2.4, radius: 0.8, count: 16, height: [2.0, 2.8], leaf: 'round', colors: { base: '#3f7a28', mid: '#a0b840', top: '#ffb0b0' }, leafSize: 0.11 },
    { x: 8.0, z: -2.2, radius: 0.8, count: 16, height: [2.2, 3.0], leaf: 'round', colors: { base: '#5a4a28', mid: '#b84a2a', top: '#ff4a30' }, leafSize: 0.13 },
  ];
  group.add(createStemPlants(floor, rng, bushes, quality));

  group.add(createVallisneria(floor, rng, { count: quality.low ? 60 : 110, x: [-14, -10.5], z: [-4.5, -1.8], height: [5, 7.6], colors: ['#3a6a26', '#8ac850'], lean: 0.5 }));
  group.add(createVallisneria(floor, rng, { count: quality.low ? 50 : 90, x: [10.8, 14], z: [-4.5, -2], height: [5, 7.4], colors: ['#3a6a26', '#9ad058'], lean: -0.5 }));

  group.add(
    createGrassTufts(floor, rng, {
      key: 'hair',
      count: quality.low ? 380 : 750,
      x: [-8.5, 8.5],
      z: [-4.6, 1.8],
      height: [0.4, 0.95],
      colors: ['#6aa83a', '#7ab848', '#5a9a30'],
      density: (x, z) => {
        if (inRock(x, z, 0.85) || pathMask(x, z) > 0.2) return 0;
        const nearRock = inRock(x, z, 1.9) ? 1 : 0.25;
        return nearRock * (0.5 + 0.5 * fbm3(noise, x * 0.5, 2, z * 0.5, 2) + 0.3);
      },
    })
  );

  group.add(
    createCarpet(floor, rng, {
      count: quality.low ? 7000 : 14000,
      x: [-14, 14],
      z: [-5.2, 6],
      colors: ['#58a02c', '#8ccf3c', '#c8e858'],
      density: carpetDensity,
    })
  );

  // 流木・石まわりのロゼット系
  const woodBase = [];
  for (let i = 0; i < 9; i++) {
    const a = rng.float(0, Math.PI * 2);
    const x = 3.4 + Math.cos(a) * rng.float(0.6, 1.4), z = -1.2 + Math.sin(a) * rng.float(0.4, 1.1);
    woodBase.push({ pos: new THREE.Vector3(x, floor(x, z), z), normal: new THREE.Vector3(0, 1, 0) });
  }
  group.add(
    createRosettes(rng, woodBase.slice(0, 5), {
      key: 'anubias',
      leaves: [6, 9],
      width: 0.62,
      curl: 0.3,
      fold: 0.18,
      stalk: 0.3,
      tilt: [0.5, 1.2],
      size: [0.32, 0.5],
      colors: ['#2f5a22', '#3a6a28', '#2a4f1e'],
      texBase: '#c8dcb0',
      roughness: 0.3,
    })
  );
  group.add(
    createRosettes(rng, woodBase.slice(5), {
      key: 'crypt',
      leaves: [7, 11],
      width: 0.42,
      curl: 0.7,
      fold: 0.2,
      wave: 0.35,
      stalk: 0.25,
      tilt: [0.4, 1.0],
      size: [0.4, 0.6],
      colors: ['#6a5a38', '#5a6a36', '#7a5a42', '#4f6a30'],
      texBase: '#e0d8c0',
      vein: 'rgba(255,220,200,0.35)',
    })
  );
  const cryptBack = [];
  for (let i = 0; i < 6; i++) {
    const x = rng.float(-5.5, -1.8), z = rng.float(-2.6, -1.8);
    if (inRock(x, z)) continue;
    cryptBack.push({ pos: new THREE.Vector3(x, floor(x, z), z), normal: new THREE.Vector3(0, 1, 0) });
  }
  group.add(
    createRosettes(rng, cryptBack, {
      key: 'crypt2',
      leaves: [7, 10],
      width: 0.4,
      curl: 0.7,
      fold: 0.2,
      wave: 0.3,
      stalk: 0.25,
      tilt: [0.3, 0.9],
      size: [0.5, 0.75],
      colors: ['#7a4a3a', '#8a5a40', '#6a5a38'],
      texBase: '#e8d0c0',
    })
  );
  // ミクロソリウム（流木の上）
  const fernSpots = surfaceSpots([wood], rng, 9, {
    fromAbove: true,
    center: (r) => new THREE.Vector3(r.float(1.2, 5.2), 0, r.float(-2.6, 0)),
    minNormalY: 0.3,
    filter: (p) => p.y > 1.4,
  });
  group.add(
    createRosettes(rng, fernSpots, {
      key: 'fern',
      leaves: [5, 8],
      width: 0.2,
      curl: 0.8,
      fold: 0.3,
      stalk: 0.12,
      tilt: [0.5, 1.3],
      size: [0.55, 0.95],
      colors: ['#3a6a2a', '#4f7f32', '#2f5a24'],
      texBase: '#d0e4b8',
      swayAmp: 0.12,
    })
  );
  // モス（流木と石の上面）
  const mossWood = surfaceSpots([wood], rng, quality.low ? 300 : 650, {
    center: () => new THREE.Vector3(3.2, 2.2, -1.3),
    minDirY: -0.05,
    minNormalY: 0.05,
  });
  const mossStone = surfaceSpots(rocks.slice(0, 3), rng, quality.low ? 40 : 90, {
    fromAbove: true,
    center: (r) => new THREE.Vector3(r.float(-5.5, -0.5), 0, r.float(-1.8, 1.0)),
    minNormalY: 0.55,
  });
  group.add(createMoss(rng, [...mossWood, ...mossStone], { size: [0.14, 0.26], colors: ['#3e6a26', '#4f7a2a', '#5a8a30', '#34601f'] }));

  // ---------------- 環境 ----------------
  group.add(createBackdrop({ top: '#0c3e56', mid: '#3f93a6', bottom: '#cbece4', glow: '#5a8a80', glowX: 0.02, glowY: 0.22, z: -8 }));
  group.add(createSurface({ y: S, deep: '#12404c', reflect: '#4a98a4', sky: '#f0fdff', fog: '#3f8e9e', fogDensity: 0.036, edge: '#25677c' }));
  group.add(createLightRays({ color: '#f0ffe8', intensity: 0.11, count: quality.low ? 8 : 14, top: S, tilt: -0.3 }, rng));
  group.add(createParticles({ count: quality.low ? 600 : 1300, color: '#f4fff0', opacity: 0.45 }, rng));

  // 泡：CO2 ディフューザーと光合成の気泡
  const bubbleSources = [{ x: 9.2, y: floor(9.2, -2.6) + 0.3, z: -2.6, count: 90, spread: 0.06, size: 0.9, speed: 1.2 }];
  for (let i = 0; i < 40; i++) {
    const b = rng.pick(bushes);
    const x = b.x + rng.float(-b.radius, b.radius), z = b.z + rng.float(-0.6, 0.6);
    const y = floor(x, z) + rng.float(0.6, b.height[0]);
    bubbleSources.push({ x, y, z, count: 2, spread: 0.02, size: 0.45, speed: 0.6, pearl: true, height: S - y });
  }
  for (let i = 0; i < 30; i++) {
    const x = rng.float(-6, 6), z = rng.float(-1, 4);
    if (pathMask(x, z) > 0.2) continue;
    const y = floor(x, z) + 0.08;
    bubbleSources.push({ x, y, z, count: 1, spread: 0.01, size: 0.35, speed: 0.5, pearl: true, height: S - y });
  }
  group.add(createBubbles(bubbleSources, rng, S));

  // ---------------- 魚の世界 ----------------
  const obstacles = [...rocks.map((r) => r.userData.obstacle), ...wood.userData.obstacles];
  const world = {
    bounds: { minX: -8, maxX: 8, minY: 0.4, maxY: S - 0.4, minZ: -3.0, maxZ: 3.6 },
    floor,
    obstacles,
    anemones: [],
    homes: [],
  };
  return { group, world };
}
