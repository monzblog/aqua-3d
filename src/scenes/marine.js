import * as THREE from 'three';
import { createNoise3D, fbm3, Rng, clamp, smoothstep } from '../shared.js';
import { createBackdrop, createSurface, createLightRays, createParticles, createBubbles, createSubstrate, createPebbles } from '../env.js';
import { createRock } from '../hardscape.js';
import { surfaceSpots } from '../plants.js';
import { createAcropora, createTableCoral, createBrainCoral, createAnemone, createEuphyllia, createZoanthids, createMushrooms, createSeaFan, createLeather } from '../reef.js';
import { MARINE_SPECIES } from '../fish/speciesMarine.js';

export const MARINE_CONFIG = {
  surfaceY: 8.2,
  focusX: -0.6,
  portrait: { hv: 9.2, camY: 4.3, lookY: 3.95 },
  fog: { color: '#0c4c84', density: 0.034 },
  water: { absorb: [0.07, 0.028, 0.017] },
  sun: { color: '#eef6ff', intensity: 4.4, pos: [-9, 28, 5] },
  sunEntry: [-2.5, -2.5],
  volume: { intensity: 0.4, color: '#dff0ff', coverage: 0.3 },
  hemi: { sky: '#7ab8ff', ground: '#142040', intensity: 0.45 },
  env: { top: '#d0ecff', mid: '#2a6aa8', bottom: '#0a1830' },
  caustic: { strength: 3.2, color: '#eaf6ff', scale: 0.22 },
  exposure: 0.95,
  bloom: { strength: 0.34, radius: 0.55, threshold: 0.86 },
  species: MARINE_SPECIES,
};

export function buildMarine(quality) {
  const group = new THREE.Group();
  const rng = new Rng(777);
  const noise = createNoise3D(88);
  const S = MARINE_CONFIG.surfaceY;

  const floor = (x, z) => {
    let h = 0.3 + clamp(4.5 - z, 0, 13) * 0.09;
    h += fbm3(noise, x * 0.25, 0, z * 0.25, 3) * 0.25;
    // 砂紋
    h += Math.sin(x * 5.5 + z * 1.2 + fbm3(noise, x * 0.6, 1, z * 0.6, 2) * 4) * 0.018;
    return h;
  };
  const sandA = new THREE.Color('#e2dccb'), sandB = new THREE.Color('#cfc4aa'), sandC = new THREE.Color('#a8a090');
  group.add(
    createSubstrate(
      floor,
      (x, z, h, c) => {
        const n = fbm3(noise, x * 1.1, 4, z * 1.1, 3);
        c.copy(sandA).lerp(sandB, clamp(n + 0.5, 0, 1));
        const n2 = fbm3(noise, x * 3, 9, z * 3, 2);
        if (n2 > 0.3) c.lerp(sandC, (n2 - 0.3) * 0.8);
      },
      { seed: 8, bump: 0.8, grainVar: 45, brightness: 0.8 }
    )
  );
  group.add(
    createPebbles(floor, rng, {
      count: quality.low ? 200 : 420,
      x: [-12, 12],
      z: [-3, 5],
      size: [0.025, 0.07],
      colors: ['#f4efe4', '#d8cfc0', '#c8b8a8', '#e8d8d0'],
    })
  );

  // ---------------- ライブロック ----------------
  const pal = { dark: '#2e2624', base: '#b4a08a', coralline: '#8a4a82', coralline2: '#d0709a', algae: '#56784a' };
  const defs = [
    // 左の島（高くそびえる岩組み）
    { p: [-3.5, 0.5, -1.5], s: [2.2, 1.6, 1.6] },
    { p: [-5.0, 1.6, -1.9], s: [1.5, 1.5, 1.2] },
    { p: [-2.3, 2.0, -1.6], s: [1.2, 1.2, 1.0] },
    { p: [-3.6, 3.0, -2.0], s: [1.1, 1.2, 0.9] },
    { p: [-2.9, 4.1, -2.2], s: [0.8, 1.0, 0.7] },
    { p: [-4.5, 3.5, -2.4], s: [0.9, 0.9, 0.8] },
    { p: [-5.8, 0.4, -0.3], s: [1.1, 0.8, 0.9] },
    { p: [-1.5, 0.4, -0.2], s: [0.9, 0.7, 0.8] },
    { p: [-6.9, 1.2, -2.7], s: [1.6, 1.9, 1.3] },
    { p: [-8.8, 0.7, -2.3], s: [1.4, 1.2, 1.1] },
    { p: [-10.6, 1.2, -3.0], s: [1.5, 2.0, 1.3] },
    { p: [-7.6, 2.8, -3.0], s: [1.0, 1.1, 0.9] },
    // 右の島
    { p: [3.6, 0.5, -1.6], s: [2.0, 1.4, 1.5] },
    { p: [4.8, 1.6, -1.9], s: [1.3, 1.3, 1.1] },
    { p: [3.0, 2.2, -2.1], s: [1.0, 1.1, 0.8] },
    { p: [4.1, 3.1, -2.3], s: [0.8, 0.9, 0.7] },
    { p: [6.0, 0.5, -0.6], s: [1.1, 0.8, 1.0] },
    { p: [2.2, 0.35, -0.5], s: [0.8, 0.55, 0.7] },
    { p: [7.0, 1.4, -2.8], s: [1.5, 2.0, 1.3] },
    { p: [9.0, 0.7, -2.3], s: [1.3, 1.1, 1.1] },
    { p: [10.8, 1.3, -3.0], s: [1.5, 2.1, 1.3] },
    { p: [8.0, 3.0, -3.1], s: [0.9, 1.0, 0.8] },
    // 奥の低い岩
    { p: [0.4, 0.35, -3.9], s: [1.6, 0.9, 1.1] },
    { p: [-0.9, 0.5, -4.6], s: [1.4, 1.2, 1.0] },
    { p: [1.9, 0.5, -4.4], s: [1.2, 1.0, 1.0] },
  ];
  const rocks = defs.map((d, i) => {
    const r = createRock({
      seed: 400 + i,
      style: 'live',
      detail: quality.low ? 4 : 5,
      scale: d.s,
      taper: 0.1,
      position: new THREE.Vector3(d.p[0], floor(d.p[0], d.p[2]) + d.p[1] - 0.3, d.p[2]),
      rotation: [rng.float(-0.2, 0.2), rng.float(0, 6.28), rng.float(-0.2, 0.2)],
      palette: pal,
    });
    group.add(r);
    return r;
  });

  const ray = new THREE.Raycaster();
  const topAt = (x, z) => {
    ray.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
    const h = ray.intersectObjects(rocks, false);
    return h.length ? h[0].point.y : floor(x, z);
  };
  const place = (obj, x, z, sink = 0.05, rotY = 0) => {
    obj.position.set(x, topAt(x, z) - sink, z);
    obj.rotation.y = rotY;
    group.add(obj);
    return obj;
  };

  // ---------------- サンゴ ----------------
  const acroCols = [
    { x: -2.9, z: -2.2, base: '#8a7a62', tip: '#8a7aff', size: 1.9 },
    { x: -2.0, z: -1.5, base: '#8a8060', tip: '#40d8ff', size: 1.3 },
    { x: 4.1, z: -2.3, base: '#8a8060', tip: '#50f0a8', size: 1.7 },
    { x: 3.0, z: -2.0, base: '#8a7868', tip: '#ffe070', size: 1.2 },
    { x: -5.0, z: -1.9, base: '#8a7060', tip: '#ff78c8', size: 1.4 },
    { x: -4.5, z: -2.5, base: '#7a7068', tip: '#b070ff', size: 1.3 },
    { x: -6.9, z: -2.7, base: '#7a7a64', tip: '#ffd060', size: 1.5 },
    { x: -7.6, z: -3.0, base: '#7a7068', tip: '#60ffb0', size: 1.2 },
    { x: 7.0, z: -2.8, base: '#7a7068', tip: '#6ac8ff', size: 1.6 },
    { x: 8.0, z: -3.1, base: '#7a7068', tip: '#ff8ad0', size: 1.2 },
    { x: -10.6, z: -3.0, base: '#7a7068', tip: '#8af0ff', size: 1.5 },
    { x: 10.8, z: -3.0, base: '#7a7068', tip: '#c8ff70', size: 1.5 },
  ];
  const coralObstacles = [];
  for (const a of acroCols) {
    const m = createAcropora(rng, { base: a.base, tip: a.tip, size: a.size, trunks: 6, depth: quality.low ? 2 : 3, fluo: 0.8 });
    place(m, a.x, a.z, 0.1, rng.float(0, 6));
    coralObstacles.push({ x: a.x, y: m.position.y + a.size * 0.4, z: a.z, r: a.size * 0.6 });
  }
  const table = createTableCoral(rng, { radius: 1.15, inner: '#90b488', outer: '#58c4a8', rim: '#c88aff', stalk: 0.35, seed: 5 });
  place(table, 4.7, -1.6, -0.25);
  coralObstacles.push({ x: 4.7, y: table.position.y, z: -1.6, r: 1.1 });
  const table2 = createTableCoral(rng, { radius: 0.8, inner: '#a8a070', outer: '#d8c060', rim: '#ff9ad0', stalk: 0.3, seed: 9 });
  place(table2, -3.3, -2.0, -0.2);

  const brain1 = createBrainCoral(rng, { size: 0.5, ridge: '#62d470', valley: '#5a3420', seed: 3 });
  brain1.position.set(1.1, floor(1.1, 0.7) + 0.05, 0.7);
  group.add(brain1);
  const brain2 = createBrainCoral(rng, { size: 0.36, ridge: '#ff9a50', valley: '#2a5a8a', seed: 7 });
  brain2.position.set(-0.9, floor(-0.9, 1.5) + 0.03, 1.5);
  group.add(brain2);
  const brain3 = createBrainCoral(rng, { size: 0.42, ridge: '#e060ff', valley: '#1a4a3a', seed: 13 });
  place(brain3, -5.7, -0.4, 0.15);
  coralObstacles.push({ x: 1.1, y: brain1.position.y, z: 0.7, r: 0.55 });

  place(createEuphyllia(rng, { size: 1.0, base: '#6a8a50', tip: '#d8ff60', heads: 5 }), -1.6, -0.3, 0.1);
  place(createEuphyllia(rng, { size: 0.9, base: '#6aa080', tip: '#80ffd8', heads: 4, hammer: true }), 5.8, -0.6, 0.1);
  place(createEuphyllia(rng, { size: 0.8, base: '#8a6a50', tip: '#ffb070', heads: 4 }), -8.5, -2.1, 0.1);

  const anemonePos = [];
  const an1 = createAnemone(rng, { radius: 0.5, length: 0.45, base: '#a8604a', tip: '#ff6aa0', disc: '#9a5a44', count: quality.low ? 110 : 170 });
  place(an1, 2.2, -0.5, 0.05);
  anemonePos.push(an1.position.clone().add(new THREE.Vector3(0, 0.2, 0)));
  const an2 = createAnemone(rng, { radius: 0.42, length: 0.4, base: '#5a8a50', tip: '#aaff80', disc: '#4a7040', count: quality.low ? 90 : 140 });
  place(an2, -4.2, -0.6, 0.05);
  anemonePos.push(an2.position.clone().add(new THREE.Vector3(0, 0.2, 0)));

  const fan1 = createSeaFan(rng, { size: 2.6, color: '#9a30b8', depth: quality.low ? 4 : 5 });
  fan1.position.set(-0.6, floor(-0.6, -3.6) - 0.05, -3.6);
  fan1.rotation.y = 0.25;
  group.add(fan1);
  const fan2 = createSeaFan(rng, { size: 1.9, color: '#e8602a', depth: 4 });
  place(fan2, 6.8, -2.9, 0.05, -0.3);
  const fan3 = createSeaFan(rng, { size: 2.0, color: '#c02a60', depth: 4 });
  place(fan3, -6.9, -2.7, 0.05, 0.4);

  const fan4 = createSeaFan(rng, { size: 2.2, color: '#7a38c8', depth: 4 });
  fan4.position.set(2.8, floor(2.8, -4.4) - 0.05, -4.4);
  fan4.rotation.y = -0.4;
  group.add(fan4);
  const fan5 = createSeaFan(rng, { size: 1.6, color: '#ff4a6a', depth: 4 });
  place(fan5, -2.9, -2.3, 0.05, 0.2);
  const brain4 = createBrainCoral(rng, { size: 0.38, ridge: '#40e0d0', valley: '#6a2a4a', seed: 17 });
  place(brain4, 3.6, -1.0, 0.12);
  const brain5 = createBrainCoral(rng, { size: 0.3, ridge: '#ffd040', valley: '#304a2a', seed: 19 });
  brain5.position.set(-2.4, floor(-2.4, 0.9) + 0.03, 0.9);
  group.add(brain5);

  const leather = createLeather(rng, { size: 1.1, stalk: '#dccca8', cap: '#c8dc90' });
  leather.position.set(0.9, floor(0.9, -2.6) - 0.05, -2.6);
  group.add(leather);
  const leather2 = createLeather(rng, { size: 0.8, stalk: '#d8c8b0', cap: '#e8c8a0', seed: 30 });
  place(leather2, 3.6, -0.9, 0.05);

  // 岩肌のポリプ類
  const rockFaces = surfaceSpots(rocks, rng, quality.low ? 50 : 95, {
    center: (r) => rocks[r.int(0, rocks.length - 1)].position.clone(),
    minDirY: 0.1,
    minNormalY: -0.1,
    filter: (p) => p.z > -2.6,
  });
  group.add(
    createZoanthids(rng, rockFaces.slice(0, Math.floor(rockFaces.length * 0.65)), {
      palettes: [
        ['#ff8a20', '#ff9a30', '#40d060'],
        ['#20e0c0', '#18c8b0', '#ff4080'],
        ['#ffd020', '#ffe040', '#8040ff'],
        ['#50ff50', '#70ff70', '#ffffff'],
        ['#ff4040', '#ff6060', '#ffd040'],
      ],
      perColony: [12, 26],
      radius: 0.22,
    })
  );
  group.add(createMushrooms(rng, rockFaces.slice(Math.floor(rockFaces.length * 0.65)), { colors: ['#e02040', '#4050ff', '#a030d0', '#20b080', '#ff6a20'] }));

  // ---------------- 環境 ----------------
  group.add(createBackdrop({ top: '#031630', mid: '#135696', bottom: '#3f9ccf', glow: '#1a4a78', glowX: 0, glowY: 0.25, z: -8 }));
  group.add(createSurface({ y: S, deep: '#082e58', reflect: '#2270b0', sky: '#e4f6ff', fog: '#0c4c84', fogDensity: 0.02, edge: '#0b3564', sunXZ: MARINE_CONFIG.sunEntry, sunPower: 2.0 }));
  group.add(createLightRays({ color: '#e8f6ff', intensity: 0.07, count: quality.low ? 6 : 10, top: S + 0.3, tilt: 0.3, centerX: MARINE_CONFIG.sunEntry[0] + 2, spread: 5 }, rng));
  group.add(createParticles({ count: quality.low ? 700 : 1500, color: '#e8f4ff', opacity: 0.5 }, rng));
  group.add(createBubbles([{ x: -10.5, y: 5.5, z: -3.2, count: 30, spread: 0.3, size: 0.7, speed: 1.4, height: S - 5.5 }], rng, S));

  const obstacles = [...rocks.map((r) => r.userData.obstacle), ...coralObstacles];
  const homes = [
    new THREE.Vector3(-1.8, topAt(-1.8, 0.2) * 0.5 + 0.4, 0.2),
    new THREE.Vector3(2.9, topAt(2.9, -0.2) * 0.5 + 0.4, -0.2),
    new THREE.Vector3(-4.6, topAt(-4.6, -0.1) * 0.6 + 0.3, -0.1),
    new THREE.Vector3(5.2, topAt(5.2, -0.5) * 0.6 + 0.3, -0.5),
    new THREE.Vector3(0.2, floor(0.2, -1.5) + 0.5, -1.5),
  ];
  const world = {
    bounds: { minX: -8, maxX: 8, minY: 0.4, maxY: S - 0.4, minZ: -2.8, maxZ: 3.6 },
    floor,
    obstacles,
    anemones: anemonePos,
    homes,
  };
  void smoothstep;
  return { group, world };
}
