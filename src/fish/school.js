import * as THREE from 'three';
import { Rng, clamp, lerp } from '../shared.js';

// world: { bounds:{minX,maxX,minY,maxY,minZ,maxZ}, floor(x,z), obstacles:[{x,y,z,r}], anemones:[Vector3], homes:[Vector3] }

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class School {
  constructor(spec, mesh, world, seed) {
    this.spec = spec;
    this.mesh = mesh;
    this.world = world;
    this.rng = new Rng(seed);
    const bh = spec.behavior;
    this.b = {
      school: bh.school ?? 0,
      speed: bh.speed ?? 0.5,
      maxSpeed: bh.maxSpeed ?? 1.5,
      depth: bh.depth ?? [0.2, 0.8],
      neighbor: bh.neighbor ?? 1.5,
      sep: bh.sep ?? 0.4,
      hover: bh.hover ?? 0,
      bottom: !!bh.bottom,
      anemone: !!bh.anemone,
      home: !!bh.home,
      big: !!bh.big,
    };
    const n = mesh.count;
    this.n = n;
    this.fish = [];
    this.goal = new THREE.Vector3();
    this.goalTimer = 0;
    this.pickGoal(true);
    for (let i = 0; i < n; i++) {
      const p = this.randomPoint(new THREE.Vector3());
      if (this.b.school > 0.5) p.copy(this.goal).add(new THREE.Vector3(this.rng.gauss(), this.rng.gauss() * 0.4, this.rng.gauss() * 0.6).multiplyScalar(0.8));
      const dir = new THREE.Vector3(this.rng.float(-1, 1), 0, this.rng.float(-0.4, 0.4)).normalize();
      this.fish.push({
        p,
        v: dir.multiplyScalar(this.b.speed),
        fwd: dir.clone().normalize(),
        q: new THREE.Quaternion(),
        roll: 0,
        bend: 0,
        phase: this.rng.float(0, 100),
        flutter: this.rng.float(0, 6.28),
        size: spec.length * this.rng.float(0.82, 1.12),
        speedMul: this.rng.float(0.85, 1.15),
        mode: 0, // 0=通常 1=ホバー 2=ダッシュ
        modeT: this.rng.float(1, 6),
        target: this.randomPoint(new THREE.Vector3()),
        targetT: this.rng.float(0, 8),
        anchor: null,
      });
    }
    if (this.b.anemone || this.b.home) this.assignAnchors();
    this.update(0.016, 0);
  }

  assignAnchors() {
    const list = this.b.anemone ? this.world.anemones : this.world.homes;
    if (!list || !list.length) return;
    this.fish.forEach((f, i) => {
      f.anchor = list[this.b.anemone ? Math.floor(i / 2) % list.length : i % list.length];
      f.p.copy(f.anchor).add(new THREE.Vector3(this.rng.float(-0.3, 0.3), this.rng.float(0.1, 0.4), this.rng.float(-0.3, 0.3)));
    });
  }

  depthRange() {
    const B = this.world.bounds;
    const h = B.maxY - B.minY;
    return [B.minY + h * this.b.depth[0], B.minY + h * this.b.depth[1]];
  }

  randomPoint(out) {
    const B = this.world.bounds;
    const x = this.rng.float(B.minX * 0.85, B.maxX * 0.85);
    const z = this.rng.float(B.minZ, B.maxZ);
    let y;
    if (this.b.bottom) y = this.world.floor(x, z) + this.rng.float(0.08, 0.2);
    else {
      const [a, b] = this.depthRange();
      y = this.rng.float(a, b);
      y = Math.max(y, this.world.floor(x, z) + 0.5);
    }
    return out.set(x, y, z);
  }

  pickGoal(first = false) {
    this.randomPoint(this.goal);
    this.goalTimer = this.rng.float(6, 14);
    if (first) this.goalTimer *= this.rng.next();
  }

  update(dt, t, others) {
    dt = Math.min(dt, 0.05);
    const W = this.world;
    const B = W.bounds;
    const b = this.b;
    this.goalTimer -= dt;
    if (this.goalTimer <= 0) this.pickGoal();
    const fish = this.fish;
    const n = this.n;
    const nb2 = b.neighbor * b.neighbor;
    const swim = this.mesh.userData.swim;

    for (let i = 0; i < n; i++) {
      const f = fish[i];
      _f.set(0, 0, 0);
      // --- モード遷移（ホバー／ダッシュ）
      f.modeT -= dt;
      if (f.modeT <= 0) {
        const r = this.rng.next();
        if (r < b.hover) f.mode = 1;
        else if (r < b.hover + 0.12) f.mode = 2;
        else f.mode = 0;
        f.modeT = f.mode === 2 ? this.rng.float(0.4, 1.0) : this.rng.float(2, 7);
      }
      const modeSpeed = f.mode === 1 ? 0.18 : f.mode === 2 ? 2.2 : 1;
      const cruise = b.speed * f.speedMul * modeSpeed;

      // --- 群れ（分離・整列・結合）
      let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0, cnt = 0;
      let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = fish[j];
        const dx = f.p.x - o.p.x, dy = f.p.y - o.p.y, dz = f.p.z - o.p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < nb2) {
          const sepD = b.sep * (f.size + o.size) / (2 * this.spec.length);
          if (d2 < sepD * sepD && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const k = (sepD - d) / sepD / d;
            sx += dx * k; sy += dy * k; sz += dz * k;
          }
          cx += o.p.x; cy += o.p.y; cz += o.p.z;
          ax += o.v.x; ay += o.v.y; az += o.v.z;
          cnt++;
        }
      }
      _f.x += sx * 3.2; _f.y += sy * 3.2; _f.z += sz * 3.2;
      if (cnt > 0 && b.school > 0) {
        const inv = 1 / cnt;
        _f.x += (cx * inv - f.p.x) * 0.6 * b.school;
        _f.y += (cy * inv - f.p.y) * 0.6 * b.school;
        _f.z += (cz * inv - f.p.z) * 0.6 * b.school;
        _f.x += (ax * inv - f.v.x) * 0.9 * b.school;
        _f.y += (ay * inv - f.v.y) * 0.9 * b.school;
        _f.z += (az * inv - f.v.z) * 0.9 * b.school;
      }

      // --- 他の種（特に大型魚）から距離をとる
      if (others) {
        for (const os of others) {
          if (os === this) continue;
          const big = os.b.big;
          const rr = big ? os.spec.length * 0.9 : Math.max(os.spec.length, this.spec.length) * 0.6;
          const rr2 = rr * rr;
          for (let j = 0; j < os.n; j++) {
            const o = os.fish[j];
            const dx = f.p.x - o.p.x, dy = f.p.y - o.p.y, dz = f.p.z - o.p.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < rr2 && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const k = ((rr - d) / rr) * (big && !b.big ? 3.5 : 1.5) / d;
              _f.x += dx * k; _f.y += dy * k * 0.6; _f.z += dz * k;
            }
          }
        }
      }

      // --- 目標（群れの目的地 or 個体の目的地 or 住処）
      f.targetT -= dt;
      if (f.anchor) {
        if (f.targetT <= 0 || f.p.distanceToSquared(f.target) < 0.04) {
          const rad = b.anemone ? 0.45 : 0.6;
          f.target.set(
            f.anchor.x + this.rng.float(-rad, rad),
            f.anchor.y + this.rng.float(0.05, b.anemone ? 0.55 : 0.8),
            f.anchor.z + this.rng.float(-rad, rad) * 0.7
          );
          f.targetT = this.rng.float(1.5, 4);
        }
        _v.subVectors(f.target, f.p);
        _f.addScaledVector(_v, 1.4);
      } else if (b.school > 0.5) {
        _v.subVectors(this.goal, f.p);
        const d = _v.length();
        _f.addScaledVector(_v, (0.35 / Math.max(d, 1)) * 1.6);
        if (d < 1.2) this.goalTimer = Math.min(this.goalTimer, 1.5);
      } else {
        if (f.targetT <= 0 || f.p.distanceToSquared(f.target) < 0.3) {
          this.randomPoint(f.target);
          f.targetT = this.rng.float(5, 12);
        }
        _v.subVectors(f.target, f.p);
        const d = _v.length();
        _f.addScaledVector(_v, 0.5 / Math.max(d, 0.5));
      }

      // --- 境界・底・水面
      const margin = 1.0;
      const bx = (lo, hi, val) => (val < lo + margin ? (lo + margin - val) : val > hi - margin ? (hi - margin - val) : 0);
      _f.x += bx(B.minX, B.maxX, f.p.x) * 1.6;
      _f.z += bx(B.minZ, B.maxZ, f.p.z) * 2.2;
      const floorY = W.floor(f.p.x, f.p.z);
      const minY = floorY + (b.bottom ? 0.06 : 0.35);
      if (f.p.y < minY + 0.35) _f.y += (minY + 0.35 - f.p.y) * 4;
      if (f.p.y > B.maxY - 0.5) _f.y -= (f.p.y - (B.maxY - 0.5)) * 4;
      if (!b.bottom && !f.anchor) {
        const [ya, yb] = this.depthRange();
        if (f.p.y < ya) _f.y += (ya - f.p.y) * 0.5;
        if (f.p.y > yb) _f.y -= (f.p.y - yb) * 0.5;
      }
      if (b.bottom) _f.y += (floorY + 0.12 - f.p.y) * 2.5;

      // --- 障害物（岩・流木・サンゴ）
      for (const o of W.obstacles) {
        const dx = f.p.x - o.x, dy = f.p.y - o.y, dz = f.p.z - o.z;
        const rr = o.r + 0.25;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr * 1.8) {
          const d = Math.sqrt(d2) || 1e-3;
          const k = Math.max(0, (rr * 1.34 - d) / rr) * 5 / d;
          _f.x += dx * k; _f.y += dy * k; _f.z += dz * k;
        }
      }

      // --- 巡航速度への収束
      const sp = f.v.length();
      if (sp > 1e-4) _f.addScaledVector(f.v, ((cruise - sp) / sp) * 1.5);
      else _f.addScaledVector(f.fwd, cruise);

      // 上下運動を抑制（魚は基本的に水平に泳ぐ）
      _f.y *= 0.55;
      const maxAcc = (f.mode === 2 ? 4 : 1.6) * b.maxSpeed;
      const fl = _f.length();
      if (fl > maxAcc) _f.multiplyScalar(maxAcc / fl);

      f.v.addScaledVector(_f, dt);
      let s2 = f.v.length();
      const vmax = b.maxSpeed * (f.mode === 2 ? 1 : 0.7);
      if (s2 > vmax) f.v.multiplyScalar(vmax / s2);
      // ピッチ制限
      const horiz = Math.hypot(f.v.x, f.v.z);
      const maxPitch = b.bottom ? 0.25 : 0.45;
      if (Math.abs(f.v.y) > horiz * maxPitch) f.v.y = Math.sign(f.v.y) * horiz * maxPitch;
      s2 = f.v.length();
      f.p.addScaledVector(f.v, dt);
      if (f.p.y < floorY + 0.04) f.p.y = floorY + 0.04;

      // --- 向き・バンク・体の曲げ
      if (s2 > 0.02) {
        _v.copy(f.v).divideScalar(s2);
        const yawPrev = Math.atan2(f.fwd.z, f.fwd.x);
        const k = 1 - Math.exp(-dt * (f.mode === 2 ? 9 : 4.5));
        f.fwd.lerp(_v, k).normalize();
        const yawNew = Math.atan2(f.fwd.z, f.fwd.x);
        let dy = yawNew - yawPrev;
        if (dy > Math.PI) dy -= Math.PI * 2;
        if (dy < -Math.PI) dy += Math.PI * 2;
        const yawRate = dy / Math.max(dt, 1e-3);
        f.bend = lerp(f.bend, clamp(yawRate * 0.18, -0.9, 0.9), 1 - Math.exp(-dt * 6));
        f.roll = lerp(f.roll, clamp(-yawRate * 0.12, -0.5, 0.5), 1 - Math.exp(-dt * 3));
      } else {
        f.bend = lerp(f.bend, 0, 1 - Math.exp(-dt * 3));
        f.roll = lerp(f.roll, 0, 1 - Math.exp(-dt * 3));
      }
      _x.copy(f.fwd);
      _z.crossVectors(_x, UP).normalize();
      _y.crossVectors(_z, _x).normalize();
      _m.makeBasis(_x, _y, _z);
      _q.setFromRotationMatrix(_m);
      if (f.roll !== 0) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), f.roll));
      f.q.copy(_q);

      // --- 泳ぎのパラメータ
      const relSpeed = s2 / Math.max(f.size, 0.1);
      const freq = 1.2 + relSpeed * 2.4;
      f.phase += dt * freq * Math.PI * 2 * 0.55;
      const amp = 0.035 + Math.min(relSpeed, 4) * 0.018 + Math.abs(f.bend) * 0.04;
      swim.array[i * 4] = f.phase;
      swim.array[i * 4 + 1] = lerp(swim.array[i * 4 + 1] || amp, amp, 1 - Math.exp(-dt * 3));
      swim.array[i * 4 + 2] = f.bend;
      swim.array[i * 4 + 3] = f.flutter;

      _s.setScalar(f.size);
      _m.compose(f.p, f.q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    swim.needsUpdate = true;
  }
}
