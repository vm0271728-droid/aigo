// ============ Player controller: movement, camera, shooting, recoil, damage ============
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const RADIUS = .42;
export const MAX_HEALTH = 100;

// ---------- collision helpers ----------
export function groundHeightAt(col, x, z, footY = 0) {
  let g = 0;
  for (const b of col.stands) {
    if (x > b.min.x - RADIUS && x < b.max.x + RADIUS && z > b.min.z - RADIUS && z < b.max.z + RADIUS) {
      if (b.max.y <= footY + 0.55 && b.max.y > g) g = b.max.y;
    }
  }
  return g;
}

function pushOut(px, py, pz, b, r, out) {
  // horizontal AABB vs circle at height overlap [py, py+height]
  const top = b.max.y, bot = b.min.y;
  if (top - py < .05 || bot > py + 1.7 - .12) return false; // too low to block / above head step
  const cx = Math.max(b.min.x, Math.min(px, b.max.x));
  const cz = Math.max(b.min.z, Math.min(pz, b.max.z));
  const dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2), push = r - d;
    out.x += (dx / d) * push; out.z += (dz / d) * push;
  } else {
    // center inside box: push along smallest penetration axis
    const l = px - b.min.x, rr = b.max.x - px, f = pz - b.min.z, bk = b.max.z - pz;
    const m = Math.min(l, rr, f, bk);
    if (m === l) out.x -= l + r; else if (m === rr) out.x += rr + r;
    else if (m === f) out.z -= f + r; else out.z += bk + r;
  }
  return true;
}

export function resolveCollisions(col, pos, vel, r = RADIUS) {
  // pos is FOOT position. Body spans [pos.y, pos.y+1.8]
  for (let iter = 0; iter < 3; iter++) {
    const out = { x: 0, z: 0 };
    let hit = false;
    for (const b of col.solids) {
      if (Math.abs(pos.x - (b.min.x + b.max.x) / 2) > (b.max.x - b.min.x) / 2 + r + 1) continue;
      if (Math.abs(pos.z - (b.min.z + b.max.z) / 2) > (b.max.z - b.min.z) / 2 + r + 1) continue;
      if (pushOut(pos.x, pos.y, pos.z, b, r, out)) hit = true;
    }
    if (!hit) break;
    pos.x += out.x; pos.z += out.z;
    if (out.x !== 0 && vel.x * out.x < 0) vel.x = 0;
    if (out.z !== 0 && vel.z * out.z < 0) vel.z = 0;
  }
}

// ray vs colliders (walls/crates). returns {t, point, normal} or null
const _tmpBox = new THREE.Box3();
export function rayCastWorld(ray, col, maxDist = 300) {
  let best = null;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (const b of col.solids) {
    if (ray.distanceToSquared(_tmpBox.set(_tmpBoxMin(b)).set(_tmpBoxMax(b))) > maxDist * maxDist) continue; // rough prune
    const t = ray.intersectBox(_tmpBox.set(V(b.min.x, b.min.y, b.min.z), V(b.max.x, b.max.y, b.max.z)), p);
    if (t === null) continue;
    const dist = t.length();
    if (dist > maxDist) continue;
    if (!best || dist < best.t) {
      // compute face normal
      const pt = t.clone();
      const eps = 1e-3;
      let nx = 0, ny = 0, nz = 0;
      if (Math.abs(pt.x - b.min.x) < eps) nx = -1; else if (Math.abs(pt.x - b.max.x) < eps) nx = 1;
      else if (Math.abs(pt.y - b.min.y) < eps) ny = -1; else if (Math.abs(pt.y - b.max.y) < eps) ny = 1;
      else if (Math.abs(pt.z - b.min.z) < eps) nz = -1; else if (Math.abs(pt.z - b.max.z) < eps) nz = 1;
      best = { t: dist, point: pt, normal: V(nx, ny, nz) };
    }
  }
  return best;
}
function _tmpBoxMin(b) { return V(b.min.x, b.min.y, b.min.z); }
function _tmpBoxMax(b) { return V(b.max.x, b.max.y, b.max.z); }

// capsule (vertical cylinder r, from base to base+h) vs segment a->b distance
export function segCapsuleHit(a, b, capBase, capR, capH) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-9 ? (((capBase.x - a.x) * abx + (capBase.z - a.z) * abz)) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  const dx = capBase.x - cx, dz = capBase.z - cz;
  const hd = Math.sqrt(dx * dx + dz * dz);
  // vertical proximity: if within radius horizontally, check y overlap
  if (hd <= capR) {
    const sy = cy; // segment point height
    if (sy >= capBase.y - capR && sy <= capBase.y + capH + capR) {
      return { t, frac: t };
    }
  }
  return null;
}

// ---------- weapon state holder ----------
export class WeaponState {
  constructor(def) {
    this.def = def;
    this.mag = def.mag === Infinity ? Infinity : def.mag;
    this.reserve = def.reserve;
  }
}

export class Inventory {
  constructor(team) {
    this.items = {};
    this.items.knife = new WeaponState(WEAPONS.knife);
    const secId = team === 'CT' ? 'usp' : 'glock';
    this.items[secId] = new WeaponState(WEAPONS[secId]);
    this.active = 'knife';
  }
  get current() { return this.items[this.active]; }
  give(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    this.items[id] = new WeaponState(def);
    this.active = id;
    return true;
  }
  switchTo(slot) {
    const ids = Object.keys(this.items).filter(id => WEAPONS[id].slot === slot);
    if (ids.length && ids[0] !== this.active) { this.pending = ids[0]; return true; }
    this.pending = null; return false;
  }
}

// ---------- recoil pattern generator (CS-like deterministic-ish) ----------
export class Recoil {
  constructor() { this.shots = 0; this.lastShot = 0; this.resetTimer = 0; }
  reset() { this.shots = 0; }
  update(dt) {
    this.resetTimer += dt;
    if (this.resetTimer > .35) { this.shots = 0; this.resetTimer = 0; }
  }
  // returns pitch/yaw kick in radians for shot n of current spray
  kick(def) {
    const n = this.shots++;
    this.resetTimer = 0;
    const k = def.recoilKick;
    const rise = k.z * Math.min(1, .35 + n * .12);           // grows then plateaus
    const side = def.recoilSide * Math.sin(n * .9 + 1.2) * Math.min(1, n * .3);
    const jitter = n < 2 ? .0006 : .0018;
    return {
      pitch: rise + (Math.random() - .5) * jitter * 2,
      yaw: side + (Math.random() - .5) * jitter
    };
  }
}

// ---------- spread ----------
export function computeSpread(def, speedXZ, onGround, crouch, scoped) {
  if (scoped) return 0;
  let s = .0006; // standing still base (~2px)
  if (!onGround) s += def.airSpread;
  else {
    const fr = Math.min(1, speedXZ / 6);
    s += def.moveSpread * fr * fr;
    if (crouch) s *= .5;
  }
  return s;
}

// ---------- damage application ----------
export function applyDamage(target, dmgBase, headshot, armormul, hasHelmet) {
  // CS formula approximation
  let hp = target.health, ap = target.armor;
  let healthDmg, armorDmg;
  if (ap > 0) {
    const tk = headshot ? dmgBase * 4 : dmgBase; // simplified: helmet handled below
    let d = dmgBase * (1 + armormul) / 2;        // split between hp & armor
    healthDmg = dmgBase * .5 + dmgBase * armormul * .5;
    armorDmg = (dmgBase - healthDmg) * (headshot && !hasHelmet ? 1.4 : 1);
    if (healthDmg > hp) healthDmg = hp;
    armorDmg = Math.min(ap, Math.max(0, dmgBase * .5 * (1 - armormul)));
    if (headshot) { healthDmg = dmgBase * (hasHelmet ? .55 : .85); armorDmg = hasHelmet ? Math.min(ap, dmgBase * .3) : 0; }
  } else {
    healthDmg = dmgBase;
    armorDmg = 0;
  }
  hp -= Math.max(1, Math.round(healthDmg));
  ap = Math.max(0, ap - Math.round(armorDmg));
  return { hp, ap, dead: hp <= 0 };
}
