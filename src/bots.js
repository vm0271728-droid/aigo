// ============ Character models & AI bots ============
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { playerTex } from './textures.js';
import { groundHeightAt, resolveCollisions, rayCastWorld, findPathTarget, RADIUS } from './botphysics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- humanoid model builder ----------
export function buildCharacter(team, num, name) {
  const g = new THREE.Group();
  const tex = playerTex(team, num, name);
  const skinMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0xc9a184 : 0xb98d63, roughness: .9 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: .95 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x39424c : 0x4b4430, roughness: .95 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x211d17, roughness: .8 });
  const vestMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x2f3a44 : 0x3d3524, roughness: .85 });

  // legs (hips pivot groups for walk animation)
  function leg(side) {
    const hip = new THREE.Group(); hip.position.set(.13 * side, .87, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(.17, .45, .19), pantsMat);
    thigh.position.y = -.24; thigh.castShadow = true; hip.add(thigh);
    const shin = new THREE.Group(); shin.position.y = -.47; hip.add(shin);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(.15, .4, .17), pantsMat);
    sh.position.y = -.2; sh.castShadow = true; shin.add(sh);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(.16, .12, .27), bootMat);
    boot.position.set(0, -.42, .04); boot.castShadow = true; shin.add(boot);
    g.add(hip);
    return { hip, shin };
  }
  const legL = leg(1), legR = leg(-1);

  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.44, .58, .26), bodyMat);
  torso.position.y = 1.19; torso.castShadow = true; g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(.47, .34, .3), vestMat);
  vest.position.y = 1.26; vest.castShadow = true; g.add(vest);

  // arms: right arm holds weapon (shoulder pivots)
  function arm(side) {
    const sh = new THREE.Group(); sh.position.set(.29 * side, 1.42, 0);
    const up = new THREE.Mesh(new THREE.BoxGeometry(.13, .36, .14), bodyMat);
    up.position.y = -.18; up.castShadow = true; sh.add(up);
    const fore = new THREE.Group(); fore.position.y = -.36; sh.add(fore);
    const fo = new THREE.Mesh(new THREE.BoxGeometry(.12, .34, .13), bodyMat);
    fo.position.y = -.17; fo.castShadow = true; fore.add(fo);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(.1, .12, .1), skinMat);
    hand.position.y = -.38; fore.add(hand);
    g.add(sh);
    return { sh, fore, hand };
  }
  const armR = arm(1), armL = arm(-1);

  // head + helmet
  const headG = new THREE.Group(); headG.position.y = 1.62; g.add(headG);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.06, .07, .08, 8), skinMat);
  neck.position.y = -.06; headG.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.21, .24, .21), skinMat);
  head.position.y = .1; head.castShadow = true; headG.add(head);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(.26, .13, .26), vestMat);
  helm.position.y = .22; helm.castShadow = true; headG.add(helm);
  if (team === 'CT') { // visor hint
    const vis = new THREE.Mesh(new THREE.BoxGeometry(.2, .05, .02), new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: .4, metalness: .4 }));
    vis.position.set(0, .14, -.12); headG.add(vis);
  } else { // shemagh band
    const band = new THREE.Mesh(new THREE.BoxGeometry(.27, .07, .27), new THREE.MeshStandardMaterial({ color: 0x8a2f24, roughness: .95 }));
    band.position.y = .16; headG.add(band);
  }

  // weapon holder in right hand
  const gunHolder = new THREE.Group();
  armR.fore.add(gunHolder);
  gunHolder.position.set(-.05, -.36, -.1);

  // hit zones registry (meshes tagged)
  g.traverse(o => { if (o.isMesh) o.userData.charRoot = g; });
  head.userData.zone = 'head';
  helm.userData.zone = 'head';
  torso.userData.zone = 'chest';
  vest.userData.zone = 'chest';

  g.userData.parts = { legL, legR, torso, headG, armR, armL, gunHolder };
  g.userData.zones = {
    head: { center: V(0, 1.72, 0), r: .17 },
    chest: { center: V(0, 1.28, 0), r: .3 },
    stomach: { center: V(0, .98, 0), r: .26 },
    leg: { center: V(0, .45, 0), r: .24 }
  };
  return g;
}

// attach a world-model gun to character
export function equipCharacterGun(charGroup, def) {
  const parts = charGroup.userData.parts;
  while (parts.gunHolder.children.length) {
    const c = parts.gunHolder.children[0];
    parts.gunHolder.remove(c);
    c.traverse(o => { if (o.isMesh) o.geometry.dispose?.(); });
  }
  if (!def || !def.buildWM) return;
  const wm = def.buildWM();
  wm.scale.setScalar(.9);
  wm.rotation.set(-.15, 0, 0);
  wm.position.set(0, 0, -.1);
  parts.gunHolder.add(wm);
  charGroup.userData.gunDef = def;
}

// pose arms holding rifle vs pistol vs knife
export function poseForWeapon(charGroup, slot) {
  const p = charGroup.userData.parts;
  if (slot === 'knife') {
    p.armR.sh.rotation.set(-.4, 0, .3); p.armR.fore.rotation.set(-1.2, 0, 0);
    p.armL.sh.rotation.set(-.2, 0, -.15); p.armL.fore.rotation.set(-.4, 0, 0);
  } else if (slot === 'secondary') {
    p.armR.sh.rotation.set(-.9, 0, .12); p.armR.fore.rotation.set(-.5, 0, 0);
    p.armL.sh.rotation.set(-.15, 0, -.1); p.armL.fore.rotation.set(-.25, 0, 0);
  } else {
    p.armR.sh.rotation.set(-.85, 0, .25); p.armR.fore.rotation.set(-.75, 0, .1);
    p.armL.sh.rotation.set(-.75, 0, -.5); p.armL.fore.rotation.set(-.9, .3, 0);
  }
}

// simple procedural walk/idle animation
export function animateCharacter(charGroup, dt, speedXZ, onGround, aiming) {
  const p = charGroup.userData.parts;
  charGroup.userData.animPhase = (charGroup.userData.animPhase || 0) + dt * (2 + speedXZ * 1.6);
  const ph = charGroup.userData.animPhase;
  const amp = Math.min(1, speedXZ / 5);
  const sw = Math.sin(ph) * .55 * amp;
  p.legL.hip.rotation.x = sw;
  p.legR.hip.rotation.x = -sw;
  p.legL.shin.rotation.x = Math.max(0, -sw) * .9;
  p.legR.shin.rotation.x = Math.max(0, sw) * .9;
  if (!aiming) {
    p.armR.sh.rotation.x += ((p.armR.sh.rotation.x < -1 ? -.85 : -.85) - p.armR.sh.rotation.x) * Math.min(1, dt * 8);
  }
  // subtle breathing idle
  p.torso.position.y = 1.19 + Math.sin(ph * .5) * .006;
}

// death ragdoll-ish: topple over
export function animateDeath(charGroup, dt) {
  const st = charGroup.userData.deathState || (charGroup.userData.deathState = { t: 0, dir: Math.random() * Math.PI * 2 });
  st.t += dt;
  const k = Math.min(1, st.t / .8);
  charGroup.rotation.x = -k * Math.PI / 2 * .95;
  charGroup.rotation.y += dt * (1 - k) * 2;
  charGroup.position.y = Math.max(0, charGroup.position.y - dt * k * .8);
}

// ===================================================================
// BOT
// ===================================================================
let botSeq = 1;
export class Bot {
  constructor(scene, col, team, name, skill = 1, role = 'rifle') {
    this.id = 'bot' + (botSeq++);
    this.scene = scene; this.col = col;
    this.team = team; this.name = name; this.skill = skill; this.role = role;
    this.health = 100; this.armor = role === 'rifle' ? 100 : 0;
    this.hasHelmet = true;
    this.alive = true;
    this.pos = V(0, 0, 0);       // feet
    this.vel = V(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.onGround = true;
    this.radius = RADIUS;
    this.height = 1.75;
    this.group = buildCharacter(team, botSeq % 20, name);
    scene.add(this.group);
    this.inventory = { primary: null, secondary: team === 'CT' ? 'usp' : 'glock', active: 'secondary' };
    this.mag = {}; this.lastShot = 99; this.reloadEnd = 0;
    this.state = 'idle';
    this.path = []; this.pathIdx = 0; this.repathT = 0;
    this.target = null; this.loseSightT = 99;
    this.fireMode = 'semi';
    this.nextThink = 0;
    this.strafeDir = Math.random() < .5 ? 1 : -1;
    this.strafeT = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.jumpCd = 0;
    this.noise = null; // last heard enemy pos
    this.buyDone = false;
  }

  spawn(p, facingYaw) {
    this.pos.copy(p); this.pos.y = groundHeightAt(this.col, p.x, p.z, p.y);
    this.vel.set(0, 0, 0);
    this.yaw = facingYaw; this.pitch = 0;
    this.health = 100; this.alive = true;
    this.state = 'idle'; this.path = []; this.target = null;
    this.deathState = null;
    this.onGround = true;
    this.group.visible = !this.isLocal;
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, 0, 0);
    this.group.userData.deathState = null;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.kills = this.kills || 0; this.deaths = this.deaths || 0;
    if (!this.isLocal) this.equipDefault();
  }

  equipDefault() {
    let id = this.inventory.secondary;
    if (this.role === 'awper' && this.money >= 4750) id = 'awp';
    else if (this.role === 'rifle' && this.money >= 2700) id = this.team === 'CT' ? 'm4a4' : 'ak47';
    else if (this.money >= 700) id = 'deagle';
    this.buyAndEquip(id);
  }

  buyAndEquip(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (id !== this.inventory.secondary || def.slot === 'primary') {
      // spend handled by game; here just equip
    }
    if (def.slot === 'primary') this.inventory.primary = id;
    else this.inventory.secondary = id;
    this.inventory.active = id;
    this.mag[id] = this.mag[id] ?? def.mag;
    equipCharacterGun(this.group, def);
    poseForWeapon(this.group, def.slot);
    return true;
  }

  get weaponId() { return this.inventory.active; }
  get weaponDef() { return WEAPONS[this.inventory.active]; }

  eyePos(out) {
    out.set(this.pos.x, this.pos.y + 1.6, this.pos.z);
    return out;
  }

  forward(out) {
    out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    return out.normalize();
  }

  // can this bot see point `p`?
  canSeePoint(fromP, p) {
    const dir = p.clone().sub(fromP);
    const dist = dir.length();
    if (dist < .05) return true;
    dir.multiplyScalar(1 / dist);
    const hit = rayCastWorld({ origin: fromP, direction: dir }, this.col, dist - .1);
    return !hit;
  }

  think(game, now, dt) {
    if (!this.alive) return;
    if (now < this.nextThink) return;
    this.nextThink = now + .1 + Math.random() * .08;

    const enemies = game.livingOthers(this);
    // perception: closest visible enemy within view cone/range
    let best = null, bestD = Infinity;
    const eye = this.eyePos(new THREE.Vector3());
    const fwd = this.forward(new THREE.Vector3());
    const viewRange = this.weaponId === 'awp' ? 90 : 55;
    const fovDot = this.weaponId === 'awp' ? .93 : .62;
    for (const e of enemies) {
      const ep = e instanceof PlayerRef ? e.eyePos(new THREE.Vector3()) : e.eyePos(new THREE.Vector3());
      const d = ep.clone().sub(eye);
      const dist = d.length();
      if (dist > viewRange) continue;
      d.multiplyScalar(1 / Math.max(dist, .001));
      if (d.dot(fwd) < fovDot) continue;
      if (!this.canSeePoint(eye, ep)) continue;
      if (dist < bestD) { bestD = dist; best = e; this._aimPoint = ep; }
    }
    if (best) {
      if (this.target !== best) { this.firstSeenT = now; }
      this.target = best; this.loseSightT = 0;
      this.state = 'fight';
    } else if (this.target) {
      this.loseSightT += .18;
      if (this.loseSightT > 2.5) { this.target = null; this.state = 'objective'; }
    } else {
      this.state = 'objective';
    }

    // noise hearing: recent gunfire near
    if (game.lastNoise && now - game.lastNoise.t < 3) {
      const d = game.lastNoise.pos.distanceTo(this.pos);
      if (d < 30 && !this.target) {
        this.noise = game.lastNoise.pos.clone();
        if (this.state !== 'fight') this.state = 'alert';
      }
    }

    // decide objective destination
    if (this.state !== 'fight') {
      const dest = game.botDestination(this);
      if (!dest) return;
      this.ensurePath(dest);
    } else if (this.target && !this.target.alive) {
      this.target = null;
    }
  }

  ensurePath(dest) {
    this.repathT -= .18;
    const cur = this.path.length ? this.path[this.path.length - 1] : null;
    if (!cur || cur.distanceToSquared(dest) > 9 || this.path.length === 0 || this.repathT <= 0) {
      this.path = findPathTarget(this.col, this.pos, dest);
      this.pathIdx = 0;
      this.repathT = 2 + Math.random() * 2;
    }
  }

  update(game, now, dt) {
    if (!this.alive) {
      if (this.group.visible) animateDeath(this.group, dt);
      return;
    }
    const def = this.weaponDef;

    // ------- movement -------
    let wish = V(0, 0, 0);
    let wantRun = true;
    if (this.state === 'objective' || this.state === 'alert') {
      if (this.path.length) {
        let wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
        if (wp.y < this.pos.y - .6) { // need to drop down
          // allow walking off ledges
        }
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd < 1.2) { this.pathIdx++; if (this.pathIdx >= this.path.length) this.path = []; }
        else { wish.set(dx / dd, 0, dz / dd); }
        if (this.state === 'alert') wish.multiplyScalar(.85);
      }
    } else if (this.state === 'fight') {
      // strafing & small positioning; AWPers stand still more
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeDir = Math.random() < .5 ? 1 : -1; this.strafeT = .6 + Math.random() * 1.1; }
      const toT = this.target ? this.target.pos.clone().sub(this.pos).setY(0) : V(0, 0, 0);
      const dist = toT.length();
      const ideal = def.id === 'awp' ? 22 : def.slot === 'secondary' ? 6 : 10;
      let move = V(0, 0, 0);
      if (dist > ideal + 4) move.copy(toT);
      else if (dist < ideal - 3) move.copy(toT).multiplyScalar(-1);
      move.normalize();
      const side = V(-move.z, 0, move.x).multiplyScalar(this.strafeDir);
      wish.copy(move).addScaledVector(side, .8);
      if (def.id === 'awp') wish.multiplyScalar(.15); // awp barely moves while fighting
      if (wish.lengthSq() > 1) wish.normalize();
    }

    // planting/defusing → stand still
    if (this.planting || this.defusing) wish.set(0, 0, 0);

    const maxSpeed = 5.6 * (this.planting || this.defusing ? 0 : 1);
    accelMove(this, wish, maxSpeed, dt);
    integratePhysics(this, this.col, dt);

    // face target or travel dir
    if (this.state === 'fight' && this.target && this._aimPoint) {
      aimAt(this, this._aimPoint, dt);
    } else {
      const look = wish.lengthSq() > .01 ? Math.atan2(-wish.x, -wish.z) : this.yaw;
      this.yaw = lerpAngle(this.yaw, look, Math.min(1, dt * 8));
      this.pitch *= Math.max(0, 1 - dt * 3);
    }

    // shooting
    if (this.state === 'fight' && this.target && this.target.alive) {
      this.tryShoot(game, now, dt);
    }

    // reload when empty
    const wid = this.weaponId;
    if ((this.mag[wid] ?? 0) <= 0 && !this.reloadEnd && def.mag !== Infinity) {
      this.reloadEnd = now + def.reloadTime;
    }
    if (this.reloadEnd && now >= this.reloadEnd && (this.mag[wid] ?? 0) < def.mag) {
      this.mag[wid] = def.mag; this.reloadEnd = 0;
    }

    // sync visual
    if (!this.isLocal) {
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.yaw + Math.PI;
      const spd = Math.hypot(this.vel.x, this.vel.z);
      animateCharacter(this.group, dt, spd, this.onGround, this.state === 'fight');
    }
  }

  tryShoot(game, now, dt) {
    const def = this.weaponDef;
    const interval = 60 / def.rpm;
    if (now - this.lastShot < interval) return;
    if (now < this.reloadEnd) return;
    if (def.mag !== Infinity && (this.mag[this.weaponId] ?? 0) <= 0) { this.reloadEnd = now + def.reloadTime; return; }

    // reaction time before first shot after acquiring
    if (this.firstSeenT && now - this.firstSeenT < (.18 + (1 - this.skill) * .35)) return;

    // aim quality: converge toward target with skill-based error
    const errScale = (1 - this.skill) * .09 + .006;
    const targetAim = this._aimPoint.clone();
    // occasionally aim lower (body) unless skilled & close
    if (this.skill < .8 && Math.random() < .5) targetAim.y -= .35;
    const eye = this.eyePos(new THREE.Vector3());
    const dir = targetAim.sub(eye).normalize();
    dir.x += (Math.random() - .5) * errScale;
    dir.y += (Math.random() - .5) * errScale;
    dir.z += (Math.random() - .5) * errScale;
    dir.normalize();

    // burst control for rifles: spray 3-6 then pause
    if (def.rpm >= 500) {
      this.burstCount = (this.burstCount || 0);
      if (this.burstCount <= 0) { this.burstPause = (this.burstPause || 0); }
      if (this.burstPause > 0) { this.burstPause -= dt; return; }
    }

    const muzzle = eye.clone().addScaledVector(dir, .6);
    const res = game.hitscanShoot(muzzle, dir, def, this, 1);
    if (def.mag !== Infinity) this.mag[this.weaponId] = (this.mag[this.weaponId] ?? 0) - 1;
    this.lastShot = now;
    game.registerNoise(this.pos, now);
    if (def.rpm >= 500) {
      this.burstCount++;
      if (this.burstCount >= 3 + Math.floor(this.skill * 4)) { this.burstCount = 0; this.burstPause = .35 + Math.random() * .5; }
    }
    // fx: tracer + muzzle flash at bot
    game.fxBotShot(this, muzzle, res.point, dir);
  }
}

// aim smoothing toward world point
function aimAt(bot, point, dt) {
  const eye = bot.eyePos(new THREE.Vector3());
  const d = point.clone().sub(eye);
  const yawWanted = Math.atan2(-d.x, -d.z);
  const pitchWanted = Math.atan2(d.y, Math.hypot(d.x, d.z));
  bot.yaw = lerpAngle(bot.yaw, yawWanted, Math.min(1, dt * (6 + bot.skill * 14)));
  bot.pitch += (pitchWanted - bot.pitch) * Math.min(1, dt * (6 + bot.skill * 14));
}

export function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function accelMove(ent, wishDir, maxSpeed, dt) {
  const accel = ent.onGround ? 42 : 8;
  const wish = wishDir.clone().multiplyScalar(maxSpeed);
  const vx = ent.vel.x, vz = ent.vel.z;
  ent.vel.x += clampF(wish.x - vx, accel * dt);
  ent.vel.z += clampF(wish.z - vz, accel * dt);
}
function clampF(v, m) { return Math.max(-m, Math.min(m, v)); }

export function integratePhysics(ent, col, dt) {
  // gravity
  ent.vel.y -= 22 * dt;
  const prevY = ent.pos.y;
  ent.pos.addScaledVector(ent.vel, dt);
  // ground
  const gh = groundHeightAt(col, ent.pos.x, ent.pos.z, ent.pos.y);
  if (ent.pos.y <= gh + 1e-3 && ent.vel.y <= 0) {
    ent.pos.y = gh; ent.vel.y = 0; ent.onGround = true;
  } else {
    ent.onGround = ent.pos.y <= gh + .02;
  }
  // step-up assist: if blocked low obstacle and moving, lift slightly
  resolveCollisions(col, ent.pos, ent.vel, ent.radius);
  const gh2 = groundHeightAt(col, ent.pos.x, ent.pos.z, ent.pos.y);
  if (gh2 > ent.pos.y && gh2 - ent.pos.y <= .55 && ent.onGround) ent.pos.y = gh2;
}

// lightweight reference wrapper so game code can treat player like bot
export class PlayerRef {}
