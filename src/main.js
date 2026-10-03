// ============ CS:GO WEB STRIKE — main game: loop, input, combat, economy, rounds, bomb ============
import * as THREE from 'three';
import { buildMap, SPAWNS, BOMB_SITES, WPTS, MAP_SIZE } from './map.js';
import { WEAPONS, VOICE, resumeAudio, audioCtx, ViewModelAnim, disposeGroup } from './weapons.js';
import { skyTex, bloodTex, flashTex, smokeTex } from './textures.js';
import { Fx, impactTex } from './effects.js';
import {
  EYE_STAND, EYE_CROUCH, RADIUS,
  groundHeightAt, resolveCollisions, rayCastWorld, segCapsuleHit,
  Recoil, computeSpread, applyDamage
} from './player.js';
import { Bot } from './bots.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const nowS = () => performance.now() / 1000;

// ------------------------------------------------------------------ renderer / scene
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = skyTex();
scene.fog = new THREE.Fog(0xd9c49a, 60, 190);

const camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, .05, 500);
scene.add(camera);

// lights: sun + hemi (dust2 bright day)
const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
sun.position.set(38, 62, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
sun.shadow.camera.far = 160; sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe0ea, 0xb09060, .85));

const { col } = buildMap(scene);
const fx = new Fx(scene);
fx.setTextures({ impact: impactTex(), blood: bloodTex(), flash: flashTex(), smoke: smokeTex() });

// ------------------------------------------------------------------ player entity (extends Bot so AI/game share code paths)
class LocalPlayer extends Bot {
  constructor() {
    super(scene, col, 'CT', 'Ты', 1, 'rifle');
    this.isLocal = true;
    this.group.visible = false;            // first person — hide own body
    this.crouch = false;
    this.walk = false;
    this.scoped = false;
    this.recoil = new Recoil();
    this.vm = new ViewModelAnim(camera);
    this.switchEnd = 0;
    this.stepDist = 0;
    this.viewKick = V(0, 0, 0);             // visual-only pitch/yaw punch
    this.dmgTakenRecent = 0;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.hsKills = 0; this.spent = 0;
    this.planting = false; this.defusing = false;
    this.money = 800; this.armor = 0; this.hasHelmet = false;
    this.reloadTarget = null;
    this.pendingSwitch = null;
    this._semiLatch = true;
    this.buildSlots();
  }
  buildSlots() {
    // per-slot weapon states: primary / secondary / knife
    this.slots = {};
    this.slots.knife = { id: 'knife', mag: Infinity, reserve: 0 };
    const secId = this.team === 'CT' ? 'usp' : 'glock';
    this.slots.secondary = { id: secId, mag: WEAPONS[secId].mag, reserve: WEAPONS[secId].reserve };
    this.slots.primary = null;
    this.activeSlot = 'secondary';
  }
  get weaponId() { const s = this.slots[this.activeSlot]; return s ? s.id : 'knife'; }
  get weaponDef() { return WEAPONS[this.weaponId]; }
  get curState() { return this.slots[this.activeSlot]; }
  eyePos(out) {
    out.set(this.pos.x, this.pos.y + (this.crouch ? EYE_CROUCH : EYE_STAND), this.pos.z);
    return out;
  }
}
const player = new LocalPlayer();
scene.add(player.group);
player.spawn(SPAWNS.CT[0], -2.35);
player.equipDefault = () => {};
player.vm.equip(player.weaponDef, true);

// viewmodel helper
function vmMuzzleWorld(out) {
  const def = player.weaponDef;
  if (!player.vm.current || !player.vm.current.group || !def.buildVM) {
    return player.eyePos(out).addScaledVector(playerForward(V(0, 0, 0)), .5);
  }
  const g = player.vm.current.group;
  g.updateMatrixWorld(true);
  const m = def.userData_muzzle || (def.userData_muzzle = def.buildVM().userData.muzzle.clone());
  out.copy(m).applyMatrix4(g.matrixWorld);
  return out;
}

// ------------------------------------------------------------------ game state
const G = {
  phase: 'menu',           // menu | freeze | live | roundend | matchend | paused
  phaseT: 0,
  round: 1, maxRounds: 16, winScore: 8, halftime: 8,
  scoreCT: 0, scoreT: 0,
  sidePlayer: 'CT',
  timer: 115,              // round time
  freezeT: 0,
  bomb: {
    carriedBy: null,       // bot or player
    planted: false, plantPos: V(0, 0, 0),
    fuse: 40, fuseLeft: 40,
    mesh: null, beeping: 0, defuser: null
  },
  ctLossBonus: 0, tLossBonus: 0,
  lastNoise: null,
  bots: [],
  lossesCT: 0, lossesT: 0,
  buyOpen: false,
  hostagesRescued: 0,
  gameOverShown: false,
};

const NAMES_T = ['Ahmed', 'Viktor', 'Boris', 'Omar', 'Farid', 'Khaled', 'Dima'];
const NAMES_CT = ['Mike', 'Steve', 'Richie', 'Tyler', 'Quinn', 'Ash', 'Jules'];

function makeTeams() {
  for (const b of G.bots) { scene.remove(b.group); disposeGroup(b.group); }
  G.bots = [];
  const roles = ['rifle', 'rifle', 'rifle', 'awper'];
  let ti = 0, ci = 0;
  for (let i = 0; i < 4; i++) {
    const bt = new Bot(scene, col, 'T', NAMES_T[ti++ % NAMES_T.length], .55 + Math.random() * .35, roles[i]);
    const bc = new Bot(scene, col, 'CT', NAMES_CT[ci++ % NAMES_CT.length], .55 + Math.random() * .35, roles[(i + 1) % 4]);
    G.bots.push(bt, bc);
  }
}
makeTeams();

// ------------------------------------------------------------------ DOM refs
const $ = id => document.getElementById(id);
const dom = {
  hud: $('hud'), menu: $('main-menu'), pause: $('pause-menu'), roundEnd: $('round-end'),
  reBanner: $('re-banner'), reReason: $('re-reason'), matchEnd: $('match-end'),
  meTitle: $('me-title'), meScore: $('me-score'), meStats: $('me-stats'),
  scoreboard: $('scoreboard'), sbCt: $('sb-ct'), sbTt: $('sb-tt'), sbTblCt: $('sb-table-ct'), sbTblTt: $('sb-table-tt'),
  timer: $('timer'), roundNum: $('round-num'), ctScore: $('ct-score'), ttScore: $('tt-score'),
  hp: $('hp'), ap: $('ap'), money: $('money'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-reserve'),
  wpnName: $('weapon-name'), reloadWrap: $('reload-bar-wrap'), reloadBar: $('reload-bar'),
  killfeed: $('killfeed'), dmgPopups: $('dmg-popups'), announcer: $('announcer'),
  scopeVig: $('scope-vignette'), crosshair: $('crosshair'), buyHint: $('buy-hint'),
  radar: $('radar'), fps: $('fps-counter'), clickLock: $('click-to-lock'),
  slotPri: $('slot-pri'), slotSec: $('slot-sec'), slotKnife: $('slot-knife'),
  hitmarker: $('hitmarker'), damageFlash: $('damage-flash'), lowhp: $('lowhp-overlay'),
};
const radarCtx = dom.radar.getContext('2d');

// ------------------------------------------------------------------ input
const keys = {};
let mouseDown = false, rmbDown = false, locked = false;
let sens = 0.0022;

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (G.phase === 'menu') return;
  switch (e.code) {
    case 'Escape':
      if (G.buyOpen) { toggleBuy(false); break; }
      if (G.phase === 'live' || G.phase === 'freeze') setPause(G.phase !== 'paused');
      break;
    case 'KeyB': if (G.phase === 'freeze' || G.phase === 'live') toggleBuy(!G.buyOpen); break;
    case 'KeyR': tryReload(); break;
    case 'KeyQ': switchWeaponToSlot('knife'); break;
    case 'Digit1': switchWeaponToSlot('primary'); break;
    case 'Digit2': switchWeaponToSlot('secondary'); break;
    case 'Digit3': switchWeaponToSlot('knife'); break;
    case 'Tab': e.preventDefault(); showScoreboard(true); break;
    case 'F3': e.preventDefault(); dom.fps.classList.toggle('hidden'); break;
    case 'KeyE': onUseKey(true); break;
    case 'ShiftLeft': player.walk = true; break;
    case 'ControlLeft': player.crouch = !player.crouch; break;
  }
  if (G.buyOpen) handleBuyKeys(e.code);
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') showScoreboard(false);
  if (e.code === 'ShiftLeft') player.walk = false;
  if (e.code === 'KeyE') onUseKey(false);
});
canvas.addEventListener('mousedown', e => {
  if (G.phase === 'menu') return;
  if (!locked) { lockMouse(); return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) { rmbDown = true; tryScope(true); }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) { rmbDown = false; tryScope(false); }
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  if (!locked) return;
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch));
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && (G.phase === 'live' || G.phase === 'freeze')) setPause(true);
  dom.clickLock.classList.toggle('hidden', locked || G.phase === 'menu');
});
function lockMouse() { canvas.requestPointerLock?.(); resumeAudio(); }

// ------------------------------------------------------------------ pause / menu wiring
function setPause(on) {
  if (on && (G.phase === 'live' || G.phase === 'freeze')) {
    G.prePausePhase = G.phase; G.phase = 'paused';
    dom.pause.classList.remove('hidden');
    document.exitPointerLock?.();
  } else if (!on && G.phase === 'paused') {
    G.phase = G.prePausePhase || 'live';
    dom.pause.classList.add('hidden');
    lockMouse();
  }
}
$('btn-play').addEventListener('click', () => startMatch());
$('btn-resume').addEventListener('click', () => setPause(false));
$('btn-restart').addEventListener('click', () => { dom.pause.classList.add('hidden'); startMatch(); });
$('btn-rematch').addEventListener('click', () => startMatch());

// ------------------------------------------------------------------ HUD helpers
function announce(text, dur = 2.2, color = null) {
  dom.announcer.textContent = text;
  dom.announcer.style.color = color || '';
  dom.announcer.classList.remove('hidden');
  clearTimeout(announce._t);
  announce._t = setTimeout(() => dom.announcer.classList.add('hidden'), dur * 1000);
}
function killFeed(killer, victim, weapon, headshot, byPlayer, onPlayer) {
  const el = document.createElement('div');
  el.className = 'kf-item ' + (killer.team === 'CT' ? 'ct-kill' : 'tt-kill');
  el.innerHTML = `<span class="kf-killer">${killer.name}</span>` +
    (headshot ? `<span class="kf-head">☠</span>` : '') +
    `<span class="kf-weapon">${weapon}</span><span class="kf-victim">${victim.name}</span>`;
  dom.killfeed.prepend(el);
  while (dom.killfeed.children.length > 6) dom.killfeed.lastChild.remove();
  setTimeout(() => el.remove(), 6000);
  if (byPlayer) { player.kills++; if (headshot) player.hsKills++; flashHitmarker(); }
  if (onPlayer) flashHitmarker(true);
}
function flashHitmarker(red) {
  dom.hitmarker.style.background = red ? '#ff5a4e' : '#fff';
  dom.hitmarker.classList.add('show');
  setTimeout(() => dom.hitmarker.classList.remove('show'), red ? 180 : 90);
}
function dmgPopup(dmg, headshot) {
  const el = document.createElement('div');
  el.className = 'dmg-num' + (headshot ? ' head' : '');
  el.textContent = dmg;
  el.style.left = (50 + (Math.random() - .5) * 6) + '%';
  el.style.top = (42 + (Math.random() - .5) * 8) + '%';
  dom.dmgPopups.appendChild(el);
  requestAnimationFrame(() => el.classList.add('go'));
  setTimeout(() => el.remove(), 700);
}

// ------------------------------------------------------------------ shooting (hitscan)
function playerForward(out) {
  return out.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch)).normalize();
}

function falloffMul(def, dist) {
  if (dist <= def.falloffStart || !def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.minDmgMul;
  const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 + (def.minDmgMul - 1) * t;
}

// segment-sphere hit: returns t fraction along a->b or null
function segSphereHit(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-9) return null;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-B - sq) / (2 * A);
  if (t < 0) t = (-B + sq) / (2 * A);
  return (t >= 0 && t <= 1) ? t : null;
}

// shared hitscan used by player & bots. shooter may be null (world only)
function hitscanShoot(origin, dir, def, shooter, spreadScale = 1, extraRange = 0) {
  const range = (def.range || 300) + extraRange;
  // apply spread
  const d = dir.clone();
  if (spreadScale > 0) {
    const s = computeSpreadOf(shooter, def) * spreadScale;
    if (s > 0) {
      const up = V(0, 1, 0);
      const right = d.clone().cross(up).normalize();
      d.addScaledVector(right, (Math.random() - .5) * s * 2)
        .addScaledVector(up, (Math.random() - .5) * s * 2).normalize();
    }
  }
  const ray = new THREE.Raycaster(origin, d, 0, range);
  const wallHit = rayCastWorld(ray, col, range);
  let wallT = wallHit ? wallHit.t : range;
  const end = origin.clone().addScaledVector(d, wallT);

  // find closest living target capsule hit
  let bestEnt = null, bestFrac = Infinity, bestZone = null;
  const ents = G.bots.filter(b => b.alive && b !== shooter);
  for (const e of ents) {
    if (shooter && e.team === shooter.team) continue; // no friendly fire
    const base = e.pos.clone();
    const h = e.crouch ? 1.15 : 1.55;               // capsule top (body)
    const headC = V(base.x, base.y + (e.crouch ? 1.3 : 1.68), base.z);
    const hit = segCapsuleHit(origin, end, base, e.radius, h);
    let frac = hit ? hit.frac : Infinity;
    // head sphere test
    const hs = segSphereHit(origin, end, headC, .26);
    let zone = 'chest';
    if (hs !== null && hs < frac) { frac = hs; zone = 'head'; }
    if (frac < bestFrac) { bestFrac = frac; bestEnt = e; bestZone = zone; }
  }
  // the local player is first-person/invisible — bots hit him via a small hitbox only when facing them would expose... simpler: allow hitting his eye-area capsule too
  if (shooter && shooter !== player && player.alive && shooter.team !== player.team) {
    const base = player.pos.clone();
    const h = player.crouch ? 1.05 : 1.45;
    const headC = V(base.x, base.y + (player.crouch ? 1.15 : 1.58), base.z);
    const hit = segCapsuleHit(origin, end, base, RADIUS, h);
    let frac = hit ? hit.frac : Infinity;
    let zone = 'chest';
    const hs = segSphereHit(origin, end, headC, .26);
    if (hs !== null && hs < frac) { frac = hs; zone = 'head'; }
    if (frac < bestFrac) { bestFrac = frac; bestEnt = player; bestZone = zone; }
  }
  let point = end, killed = false, headshot = false;
  if (bestEnt) {
    point = origin.clone().addScaledVector(d, wallT * bestFrac);
    const dist = point.distanceTo(origin);
    headshot = bestZone === 'head';
    let dmg = def.dmg * falloffMul(def, dist);
    if (headshot) dmg *= def.headMul;
    if (def.melee) dmg = def.dmg;
    const res = applyDamage(bestEnt, dmg, headshot, def.armormul, !!bestEnt.hasHelmet);
    bestEnt.health = res.hp; bestEnt.armor = res.ap;
    if (shooter === player) dmgPopup(Math.round(dmg), headshot);
    if (bestEnt === player) { dom.damageFlash.style.opacity = .8; setTimeout(() => dom.damageFlash.style.opacity = 0, 120); screenShake(def.melee ? .3 : .6); VOICE.pain(); }
    if (res.dead) {
      killed = true;
      bestEnt.alive = false;
      bestEnt.health = 0;
      onDeath(bestEnt, shooter, def, headshot);
    }
    fx.addBlood(point, d);
    if (headshot && shooter === player) VOICE.headshot();
  } else if (wallHit) {
    fx.addImpact(wallHit.point, wallHit.normal);
  }
  return { point, dir: d, hitEntity: bestEnt, killed, headshot };
}
function computeSpreadOf(ent, def) {
  if (ent === player) {
    const spd = Math.hypot(player.vel.x, player.vel.z);
    return computeSpread(def, spd, player.onGround, player.crouch, player.scoped);
  }
  const spd = ent ? Math.hypot(ent.vel.x, ent.vel.z) : 0;
  return computeSpread(def, spd, ent ? ent.onGround : true, false, false);
}
// expose to bots via game object interface
player.tryShoot = () => {};

// ------------------------------------------------------------------ player update
function updatePlayer(dt, t) {
  if (!player.alive) return;
  const def = player.weaponDef;

  // ---- movement wish dir
  let f = 0, s = 0;
  if (keys.KeyW) f += 1; if (keys.KeyS) f -= 1;
  if (keys.KeyD) s += 1; if (keys.KeyA) s -= 1;
  const fwd = V(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = V(fwd.z, 0, -fwd.x);
  const wish = new THREE.Vector3();
  wish.addScaledVector(fwd, f).addScaledVector(right, s);
  if (wish.lengthSq() > 1) wish.normalize();

  const plantingBusy = player.planting || player.defusing;
  let maxSpeed = 6.9; // ~CS running speed scale
  if (player.walk || plantingBusy) maxSpeed = 3.1;
  if (player.crouch) maxSpeed = 3.6;
  if (player.scoped) maxSpeed = 2.2;
  if (def.slot === 'knife') maxSpeed = 7.4;
  if (def.id === 'awp' && !player.scoped) maxSpeed = 5.2;

  accelMoveLocal(wish, maxSpeed, dt);

  // jump
  if (keys.Space && player.onGround && !plantingBusy) {
    player.vel.y = 6.4; player.onGround = false;
  }
  integratePhysicsLocal(dt);

  // footsteps
  const spd = Math.hypot(player.vel.x, player.vel.z);
  player.stepDist += spd * dt;
  if (player.stepDist > (player.walk ? 2.6 : 2.0) && player.onGround) {
    player.stepDist = 0; footstepSound(player.walk);
  }

  // crouch eye smoothing handled directly in eyePos

  // ---- shooting
  player.recoil.update(dt);
  const interval = 60 / def.rpm;
  if (mouseDown && locked && G.phase === 'live' && t - (player.lastShot ?? -99) >= interval && !player.reloadEnd && t > player.switchEnd && !plantingBusy) {
    tryFire(t, def);
  }
  // reload finish
  if (player.reloadEnd && t >= player.reloadEnd) {
    const st = player.slots[player.reloadTarget];
    if (st) { const mag = WEAPONS[st.id].mag; const need = mag - st.mag; const take = Math.min(need, st.reserve); st.mag += take; st.reserve -= take; }
    player.reloadEnd = 0; player.reloadTarget = null;
    player.vm.cancelReload();
    updateAmmoHud();
  }
  // switch finish
  if (player.pendingSwitch && t >= player.pendingSwitch.t) {
    finalizeSwitch(player.pendingSwitch.slot);
  }
  player.vm.update(dt, Math.min(1, spd / 6.9), spd > .5, player.scoped);

  // view punch decay (visual recoil blends back)
  player.viewKick.multiplyScalar(Math.max(0, 1 - dt * 8));

  // camera
  player.eyePos(camera.position);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(player.pitch + player.viewKick.x, player.yaw + player.viewKick.y, 0);
  // scope fov
  const wantFov = player.scoped ? 12 : 90;
  if (Math.abs(camera.fov - wantFov) > .01) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 18); camera.updateProjectionMatrix(); }
  dom.scopeVig.classList.toggle('hidden', !player.scoped);
  dom.crosshair.classList.toggle('hidden', player.scoped);
  dom.crosshair.style.setProperty('--gap', (4 + computeInaccPx() * 260) + 'px');
}
function computeInaccPx() {
  const def = player.weaponDef;
  const spd = Math.hypot(player.vel.x, player.vel.z);
  const s = computeSpread(def, spd, player.onGround, player.crouch, player.scoped);
  const rec = Math.min(.02, player.recoil.shots * .0016);
  return s + rec;
}

function accelMoveLocal(wishDir, maxSpeed, dt) {
  const accel = player.onGround ? 60 : 10;
  const wx = wishDir.x * maxSpeed, wz = wishDir.z * maxSpeed;
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  player.vel.x += clamp(wx - player.vel.x, accel * dt);
  player.vel.z += clamp(wz - player.vel.z, accel * dt);
  // friction
  if (player.onGround && wishDir.lengthSq() < .01) {
    const fr = Math.max(0, 1 - dt * 10);
    player.vel.x *= fr; player.vel.z *= fr;
  }
}
function integratePhysicsLocal(dt) {
  player.vel.y -= 22 * dt;
  player.pos.addScaledVector(player.vel, dt);
  const gh = groundHeightAt(col, player.pos.x, player.pos.z, player.pos.y);
  if (player.pos.y <= gh + 1e-3 && player.vel.y <= 0) { player.pos.y = gh; player.vel.y = 0; player.onGround = true; }
  else player.onGround = player.pos.y <= gh + .02;
  resolveCollisions(col, player.pos, player.vel, RADIUS);
  const gh2 = groundHeightAt(col, player.pos.x, player.pos.z, player.pos.y);
  if (gh2 > player.pos.y && gh2 - player.pos.y <= .55 && player.onGround) player.pos.y = gh2;
}

function footstepSound(quiet) {
  const ctx = audioCtx(); const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  const b = ctx.createBuffer(1, ctx.sampleRate * .06, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  src.buffer = b;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = quiet ? 500 : 900; bp.Q.value = .9;
  const g = ctx.createGain(); g.gain.value = quiet ? .05 : .12;
  src.connect(bp); bp.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t + .07);
}

// ------------------------------------------------------------------ firing
function tryFire(t, def) {
  const st = player.curState;
  if (!st) return;
  if (def.mag !== Infinity && st.mag <= 0) { tryReload(); return; }
  if (def.fire && !def.fire('auto')) {
    // semi: require fresh click
    if (player._semiLatch) return;
    player._semiLatch = true;
  }
  if (def.melee) {
    player.vm.slash(); def.slashSound?.();
    const eye = player.eyePos(V(0, 0, 0));
    const dir = playerForward(V(0, 0, 0));
    hitscanShoot(eye, dir, def, player, 0);
    registerNoise(player.pos, t, 6);
    player.lastShot = t;
    return;
  }
  st.mag--;
  def.sound();
  const kick = player.recoil.kick(def);
  player.viewKick.x += kick.pitch; player.viewKick.y += kick.yaw;
  // small camera climb actual (like CS: recoil moves aim)
  player.pitch += kick.pitch * .85;
  player.yaw += kick.yaw * .85;
  player.vm.addRecoil(def.recoilKick);
  const muzzle = vmMuzzleWorld(V(0, 0, 0));
  const eye = player.eyePos(V(0, 0, 0));
  const dir = playerForward(V(0, 0, 0));
  const res = hitscanShoot(eye, dir, def, player, 1);
  fx.muzzleFlash(muzzle, def.id === 'awp' ? 1.6 : 1);
  fx.addTracer(muzzle, res.point);
  const right = dir.clone().cross(V(0, 1, 0)).normalize();
  fx.ejectShell(muzzle.clone().addScaledVector(dir, -.2), right);
  registerNoise(player.pos, t, def.id === 'usp' ? 18 : 34);
  player.lastShot = t;
  updateAmmoHud();
}
document.addEventListener('mousedown', e => { if (e.button === 0) player._semiLatch = false; });

function tryReload() {
  const def = player.weaponDef;
  if (def.mag === Infinity || def.melee) return;
  const st = player.curState;
  if (!st || st.mag >= def.mag || st.reserve <= 0 || player.reloadEnd) return;
  player.reloadTarget = player.activeSlot;
  player.reloadEnd = nowS() + def.reloadTime;
  def.reloadSound?.();
  player.vm.startReload(def.reloadTime);
  dom.reloadWrap.classList.remove('hidden');
}
function updateReloadBar() {
  if (!player.reloadEnd) { dom.reloadWrap.classList.add('hidden'); return; }
  const def = player.weaponDef;
  const total = def.reloadTime;
  const left = player.reloadEnd - nowS();
  dom.reloadBar.style.width = Math.max(0, Math.min(100, (1 - left / total) * 100)) + '%';
}

function switchWeaponToSlot(slot) {
  const st = player.slots[slot];
  if (!st || slot === player.activeSlot || player.pendingSwitch || player.reloadEnd) return;
  const def = WEAPONS[st.id];
  player.pendingSwitch = { slot, t: nowS() + Math.max(.2, def.switchTime * .5) };
  player.scoped = false;
  player.vm.startSwitch(def);
}
function finalizeSwitch(slot) {
  player.activeSlot = slot;
  player.pendingSwitch = null;
  const def = player.weaponDef;
  player.switchEnd = nowS() + def.switchTime * .5;
  player.vm.equip(def, true);
  updateAmmoHud(); updateSlotsHud();
}
function giveWeapon(id) {
  const def = WEAPONS[id];
  player.slots[def.slot] = { id, mag: def.mag, reserve: def.reserve };
  player.activeSlot = def.slot;
  player.pendingSwitch = null;
  player.vm.equip(def);
  player.switchEnd = nowS() + def.switchTime;
  updateAmmoHud(); updateSlotsHud();
}
function tryScope(on) {
  const def = player.weaponDef;
  if (!def.scoped) return;
  if (on && !player.scoped && nowS() > player.switchEnd) { player.scoped = true; def.scopeIn?.(); }
  else if (!on && player.scoped) { player.scoped = false; def.scopeOut?.(); }
}

// ------------------------------------------------------------------ noise system (bot hearing)
function registerNoise(pos, t, radius = 30) {
  G.lastNoise = { pos: pos.clone(), t, radius };
}

// ------------------------------------------------------------------ deaths / rounds
function onDeath(victim, killer, def, headshot) {
  const isBotVictim = victim !== player;
  killFeed(killer || { name: 'мир', team: 'CT' }, victim, def?.name || 'нож', headshot, killer === player, victim === player);
  if (killer && killer !== player && killer.name !== 'Bomba' && killer.name !== 'мир') killer.kills = (killer.kills || 0) + 1;
  victim.deaths = (victim.deaths || 0) + 1;
  if (victim === player) {
    screenShake(.6);
    dom.damageFlash.classList.add('big');
    setTimeout(() => dom.damageFlash.classList.remove('big'), 300);
    // deathcam: pull camera back a bit
  }
  // drop bomb?
  if (G.bomb.carriedBy === victim) {
    G.bomb.carriedBy = null;
    dropBombWorld(victim.pos);
  }
  checkRoundEnd();
}
function screenShake(a) { player.viewKick.x += (Math.random() - .5) * a * .1; player.viewKick.y += (Math.random() - .5) * a * .1; }

// ------------------------------------------------------------------ bomb
function initBombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(.32, .16, .2), new THREE.MeshStandardMaterial({ color: 0x2b2f28, roughness: .6 }));
  g.add(body);
  const disp = new THREE.Mesh(new THREE.BoxGeometry(.18, .06, .01), new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0x901000 }));
  disp.position.set(0, .06, .105); g.add(disp);
  const wires = new THREE.Mesh(new THREE.BoxGeometry(.1, .04, .12), new THREE.MeshStandardMaterial({ color: 0x992b2b }));
  wires.position.set(.1, .1, 0); g.add(wires);
  g.visible = false;
  scene.add(g);
  G.bomb.mesh = g;
}
initBombMesh();
function dropBombWorld(pos) {
  const p = pos.clone();
  p.x += (Math.random() - .5) * 2; p.z += (Math.random() - .5) * 2;
  p.y = groundHeightAt(col, p.x, p.z, 1) + .08;
  G.bomb.dropPos = p;
  G.bomb.mesh.position.copy(p);
  G.bomb.mesh.visible = true;
  G.bomb.mesh.rotation.y = Math.random() * 6;
}
function giveBombToT(team) {
  const cand = G.bots.filter(b => b.team === team && b.alive);
  if (!cand.length) return;
  const b = cand[Math.floor(Math.random() * cand.length)];
  G.bomb.carriedBy = b; G.bomb.dropPos = null;
  G.bomb.mesh.visible = false;
}
function bombTick(dt, t) {
  const B = G.bomb;
  if (B.planted) {
    B.fuseLeft -= dt;
    // beep faster
    const period = Math.max(.12, B.fuseLeft / 12);
    B.beeping -= dt;
    if (B.beeping <= 0) { B.beeping = period; beep(B.fuseLeft < 10 ? 1400 : 900, .08, B.fuseLeft < 10 ? .1 : .06); }
    B.mesh.position.y = B.plantPos.y + .08 + Math.sin(t * 20) * .002;
    if (B.fuseLeft <= 0) explodeBomb();
  } else if (B.carriedBy) {
    B.mesh.visible = false;
  }
}
function beep(freq, vol, dur) {
  const ctx = audioCtx(); const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + .02);
}
function explodeBomb() {
  const B = G.bomb;
  B.planted = false; B.mesh.visible = false;
  // boom
  const ctx = audioCtx(); const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  const len = ctx.sampleRate * 1.2; const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  src.buffer = buf;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(60, t + 1);
  const g = ctx.createGain(); g.gain.value = .9;
  src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start(t);
  const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(70, t); osc.frequency.exponentialRampToValueAtTime(30, t + .8);
  const og = ctx.createGain(); og.gain.setValueAtTime(.8, t); og.gain.exponentialRampToValueAtTime(.001, t + .9);
  osc.connect(og); og.connect(ctx.destination); osc.start(t); osc.stop(t + 1);
  // explosion fx + damage
  const c = B.plantPos.clone().setY(B.plantPos.y + 1);
  for (let i = 0; i < 24; i++) fx._spark(c.addScaledVector(V(Math.random() - .5, Math.random() - .5, Math.random() - .5), 2), V(0, 1, 0));
  fx.muzzleFlash(c, 9);
  const all = [...G.bots, player];
  for (const e of all) {
    if (!e.alive) continue;
    const dd = e.pos.distanceTo(B.plantPos);
    if (dd > 16) continue;
    const dmg = Math.round(95 * (1 - dd / 16));
    const res = applyDamage(e, dmg, false, .5, !!e.hasHelmet);
    e.health = res.hp; e.armor = res.ap;
    if (res.dead) onDeath(e, { name: 'Bomba', team: 'T' }, { name: 'C4' }, false);
    if (e === player && !res.dead) { dom.damageFlash.classList.add('big'); setTimeout(() => dom.damageFlash.classList.remove('big'), 400); screenShake(1.5); }
  }
  endRound('T', 'Бомба взорвалась');
}
function onUseKey(down) {
  if (!down) { player.planting = false; player.defusing = false; return; }
  if (!player.alive || G.phase !== 'live') return;
  const B = G.bomb;
  // plant: player is T-side? player always CT here unless switched sides at halftime
  if (player.team === 'T' && B.carriedBy === player) {
    const site = nearestSite(player.pos);
    if (site) {
      player.planting = true;
      player.plantProgress = (player.plantProgress || 0);
    }
  } else if (!B.carriedBy && B.dropPos && player.pos.distanceTo(B.dropPos) < 2.5 && player.team === 'T') {
    B.carriedBy = player; B.dropPos = null; B.mesh.visible = false;
    announce('Вы подобрали бомбу', 1.5);
  }
  if (B.planted && player.team === 'CT' && player.pos.distanceTo(B.plantPos) < 2.5) {
    player.defusing = true;
  }
}
function nearestSite(p) {
  for (const k of Object.keys(BOMB_SITES)) {
    const s = BOMB_SITES[k];
    if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < s.radius + 2) return k;
  }
  return null;
}
function updatePlantDefuse(dt) {
  const B = G.bomb;
  if (player.planting && B.carriedBy === player && nearestSite(player.pos)) {
    player.plantProgress += dt;
    showProgressBar('Установка C4…', player.plantProgress / 3.2);
    if (player.plantProgress >= 3.2) {
      player.planting = false; player.plantProgress = 0; hideProgressBar();
      B.planted = true; B.carriedBy = null;
      B.plantPos.copy(player.pos).setY(groundHeightAt(col, player.pos.x, player.pos.z, 1) + .1);
      B.fuseLeft = B.fuse;
      B.mesh.position.copy(B.plantPos); B.mesh.visible = true;
      VOICE.bombPlanted();
      announce('Бомба заложена!', 2.5, '#e5c67f');
    }
  } else { player.plantProgress = 0; if (!player.defusing) hideProgressBar(); }
  if (player.defusing && B.planted && player.pos.distanceTo(B.plantPos) < 2.5) {
    player.defuseProgress += dt;
    showProgressBar('Обезвреживание…', player.defuseProgress / 10);
    if (player.defuseProgress >= 10) {
      player.defusing = false; player.defuseProgress = 0; hideProgressBar();
      B.planted = false; B.mesh.visible = false;
      announce('Бомба обезврежена!', 2.5, '#7fb2e5');
      endRound('CT', 'Бомба обезврежена');
    }
  } else { player.defuseProgress = 0; if (!player.planting) hideProgressBar(); }
}
let progEl = null;
function showProgressBar(label, frac) {
  if (!progEl) {
    progEl = document.createElement('div');
    progEl.id = 'c4-progress';
    progEl.innerHTML = '<div class="cp-label"></div><div class="cp-track"><div class="cp-fill"></div></div>';
    dom.hud.appendChild(progEl);
  }
  progEl.classList.remove('hidden');
  progEl.querySelector('.cp-label').textContent = label;
  progEl.querySelector('.cp-fill').style.width = Math.min(100, frac * 100) + '%';
}
function hideProgressBar() { progEl?.classList.add('hidden'); }

// ------------------------------------------------------------------ bots objective destinations
G.livingOthers = (self) => {
  const list = G.bots.filter(b => b.alive && b.team !== self.team);
  if (self.team !== player.team && player.alive) list.push(player);
  return list;
};
G.botDestination = (bot) => {
  const B = G.bomb;
  if (bot.team === 'T') {
    if (B.planted) {
      // guard bomb: go near plant pos
      return B.plantPos.clone().add(V((Math.random() - .5) * 6, 0, (Math.random() - .5) * 6));
    }
    if (B.carriedBy === bot) {
      // push toward a site
      const site = Math.random() < .6 ? 'A' : 'B';
      return BOMB_SITES[site].pos.clone();
    }
    // teammates escort / attack sites
    const pick = Math.random();
    if (pick < .45) return WPTS.siteA.clone().add(V((Math.random() - .5) * 6, 0, (Math.random() - .5) * 6));
    if (pick < .8) return WPTS.siteB.clone().add(V((Math.random() - .5) * 6, 0, (Math.random() - .5) * 6));
    return WPTS.catwalk.clone();
  } else {
    // CT defend
    if (B.planted) return B.plantPos.clone().add(V((Math.random() - .5) * 5, 0, (Math.random() - .5) * 5));
    const pick = Math.random();
    if (pick < .4) return WPTS.siteAtop.clone();
    if (pick < .7) return WPTS.connB.clone();
    return WPTS.midDoors.clone();
  }
};
G.hitscanShoot = (origin, dir, def, shooter, spreadScale) => hitscanShoot(origin, dir, def, shooter, spreadScale);
G.registerNoise = (pos, t) => registerNoise(pos, t, 30);
G.fxBotShot = (bot, muzzle, point, dir) => {
  fx.addTracer(muzzle, point);
  fx.muzzleFlash(muzzle, .8);
  const def = bot.weaponDef;
  def.sound && def.sound();
};

// bot plant/defuse logic
function botObjectiveActions(dt, t) {
  const B = G.bomb;
  for (const bot of G.bots) {
    if (!bot.alive) continue;
    // carry & plant
    if (bot.team === 'T' && B.carriedBy === bot && !B.planted) {
      const site = nearestSite(bot.pos);
      if (site && (!bot.target || !bot.target.alive)) {
        bot.planting = true;
        bot.plantProgress += dt;
        if (bot.plantProgress >= 3.4) {
          bot.planting = false; bot.plantProgress = 0;
          B.planted = true; B.carriedBy = null;
          B.plantPos.copy(bot.pos).setY(groundHeightAt(col, bot.pos.x, bot.pos.z, 1) + .1);
          B.fuseLeft = B.fuse;
          B.mesh.position.copy(B.plantPos); B.mesh.visible = true;
          VOICE.bombPlanted();
          announce('Бомба заложена!', 2.5, '#e5c67f');
        }
      } else bot.planting = false;
    }
    // CT defuse
    if (bot.team === 'CT' && B.planted && !B.carriedBy && bot.pos.distanceTo(B.plantPos) < 2 && countEnemiesNear(B.plantPos, bot) === 0) {
      bot.defusing = true;
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= 10) {
        bot.defusing = false; bot.defuseProgress = 0;
        B.planted = false; B.mesh.visible = false;
        announce(`${bot.name} обезвредил бомбу!`, 2.5, '#7fb2e5');
        endRound('CT', 'Бомба обезврежена');
      }
    } else bot.defusing = false;
  }
}
function countEnemiesNear(p, self) {
  let n = 0;
  for (const b of G.bots) if (b.alive && b.team !== self.team && b.pos.distanceTo(p) < 12) n++;
  if (self.team !== player.team && player.alive && player.pos.distanceTo(p) < 12) n++;
  return n;
}

// ------------------------------------------------------------------ economy & rounds
const BUY_LIST = [
  { code: 'Digit1', auto: true, label: 'Винтовка (AK-47/M4A4)' },
  { code: 'Digit2', id: 'awp', label: 'AWP — 4750$' },
  { code: 'Digit3', id: 'deagle', label: 'Desert Eagle — 700$' },
  { code: 'Digit4', buy: 'kevlar', label: 'Кевлар + Шлем — 1000$' },
];
function handleBuyKeys(code) {
  if (G.phase !== 'freeze' && !(G.phase === 'live' && G.timer > 100)) return;
  const item = BUY_LIST.find(b => b.code === code);
  if (!item) return;
  if (item.auto) {
    const id = player.team === 'CT' ? 'm4a4' : 'ak47';
    const d2 = WEAPONS[id];
    if (player.money >= d2.price) {
      player.money -= d2.price; player.spent += d2.price;
      giveWeapon(id); announce(d2.name + ' куплен', 1.2);
    } else VOICE.noBuy();
    updateMoneyHud();
    return;
  }
  if (item.buy === 'kevlar') {
    if (player.money >= 1000) {
      player.money -= 1000; player.spent += 1000;
      player.armor = 100; player.hasHelmet = true;
      for (const b of G.bots) if (b.team === player.team && b.alive) { b.armor = 100; }
      announce('Кевлар + шлем куплены', 1.2);
    } else VOICE.noBuy();
    updateMoneyHud();
    return;
  }
  const def = WEAPONS[item.id];
  if (player.money >= def.price) {
    player.money -= def.price; player.spent += def.price;
    giveWeapon(item.id);
    announce(def.name + ' куплен', 1.2);
  } else VOICE.noBuy();
  updateMoneyHud();
}
function toggleBuy(open) {
  G.buyOpen = open && player.alive;
  dom.buyHint.classList.toggle('hidden', !G.buyOpen);
}

function startMatch() {
  dom.menu.classList.add('hidden');
  dom.matchEnd.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  G.scoreCT = 0; G.scoreT = 0; G.round = 1;
  G.lossesCT = 0; G.lossesT = 0;
  G.sidePlayer = 'CT'; G.matchOver = false;
  player.money = 800; player.kills = 0; player.deaths = 0; player.hsKills = 0; player.spent = 0;
  player.slots.primary = null; player.activeSlot = 'secondary';
  player.armor = 0; player.hasHelmet = false;
  for (const b of G.bots) { b.money = 800; b.kills = 0; b.deaths = 0; }
  beginFreeze();
  lockMouse();
  updateScoreHud();
}
function resetLoadouts() {
  // purchases persist between rounds (simplified economy); secondary depends on current side
  const secId = player.team === 'CT' ? 'usp' : 'glock';
  const secDef = WEAPONS[secId];
  if (!player.slots.secondary || player.slots.secondary.id !== secId)
    player.slots.secondary = { id: secId, mag: secDef.mag, reserve: secDef.reserve };
  if (!player.slots.knife) player.slots.knife = { id: 'knife', mag: Infinity, reserve: 0 };
  if (!player.slots.primary) player.activeSlot = 'secondary';
  player.alive = true; player.health = 100;
  player.crouch = false; player.scoped = false; player.reloadEnd = 0; player.planting = false; player.defusing = false;
  player.plantProgress = 0; player.defuseProgress = 0;
  player.recoil.reset();
  player._semiLatch = true;
  player.lastShot = -99;
  player.vel.set(0, 0, 0);
  player.vm.equip(player.weaponDef, true);
  updateAmmoHud(); updateSlotsHud(); updateMoneyHud(); updateHpHud();
}
function beginFreeze() {
  G.phase = 'freeze'; G.freezeT = 8;
  G.timer = 115;
  // positions
  const ctSpawns = SPAWNS.CT, tSpawns = SPAWNS.T;
  const myTeam = G.sidePlayer;
  player.team = myTeam;
  const spawnArr = myTeam === 'CT' ? ctSpawns : tSpawns;
  player.pos.copy(spawnArr[0]).setY(0);
  player.vel.set(0, 0, 0);
  player.yaw = myTeam === 'CT' ? Math.atan2(-(-(34 - player.pos.x)), -(-(36 - player.pos.z))) : Math.atan2(1, 1) + Math.PI;
  player.yaw = myTeam === 'CT' ? -2.35 : .78;
  player.pitch = 0;
  player.pos.y = groundHeightAt(col, player.pos.x, player.pos.z, 0);
  player.group.position.copy(player.pos);
  resetLoadouts();

  let ci = 1, ti = 0;
  for (const b of G.bots) {
    b.alive = true; b.health = 100; b.vel.set(0, 0, 0); b.path = []; b.target = null; b.state = 'idle';
    b.reloadEnd = 0; b.lastShot = -99; b.firstSeenT = 0; b.deathState = null;
    b.group.visible = true; b.group.rotation.set(0, 0, 0); b.group.userData.deathState = null;
    b.plantProgress = 0; b.defuseProgress = 0; b.planting = false; b.defusing = false;
    // economy for bots
    b.money = b.money ?? 800;
    b.equipDefault();
    const cost = b.inventory.active === 'awp' ? 4750 : b.inventory.active === 'deagle' ? 700 : (b.inventory.primary ? 2700 : 0);
    b.money = Math.max(0, b.money - cost);
    const arr = b.team === 'CT' ? ctSpawns : tSpawns;
    const idx = b.team === 'CT' ? (ci++ % arr.length) : (ti++ % arr.length);
    b.spawn(arr[idx], b.team === 'CT' ? -2.35 : .78);
  }
  // bomb to a random T (or the player when he's on T)
  G.bomb.planted = false; G.bomb.fuseLeft = G.bomb.fuse; G.bomb.mesh.visible = false; G.bomb.dropPos = null;
  if (myTeam === 'T') { G.bomb.carriedBy = player; announce('Вы несёте бомбу — E на точке A/B', 3, '#e5c67f'); }
  else giveBombToT('T');
  announce(`Раунд ${G.round}. Закупка (${'8'} сек)`, 2.5);
  VOICE.roundStart();
  updateRoundHud();
}
function beginLive() {
  G.phase = 'live';
  toggleBuy(false);
}
function aliveCount(team) {
  let n = 0;
  for (const b of G.bots) if (b.team === team && b.alive) n++;
  if (player.team === team && player.alive) n++;
  return n;
}
let roundEnded = false;
function checkRoundEnd() {
  if (G.phase !== 'live' && G.phase !== 'freeze') return;
  if (roundEnded) return;
  const ct = aliveCount('CT'), t = aliveCount('T');
  if (t === 0) { roundEnded = true; endRound('CT', 'Все террористы ликвидированы'); }
  else if (ct === 0) { roundEnded = true; endRound('T', 'Все спецназовцы ликвидированы'); }
}
function endRound(winner, reason) {
  if (G.phase === 'roundend' || G.phase === 'matchend') return;
  G.phase = 'roundend'; G.phaseT = 0;
  if (winner === 'CT') G.scoreCT++; else G.scoreT++;
  // loss bonus banks
  if (winner === 'CT') { G.lossesT = Math.min(4, G.lossesT + 1); G.lossesCT = 0; }
  else { G.lossesCT = Math.min(4, G.lossesCT + 1); G.lossesT = 0; }
  // money award
  const plTeamWon = (player.team === winner);
  const plLossStreak = player.team === 'CT' ? G.lossesCT : G.lossesT;
  player.money = Math.min(16000, player.money + (plTeamWon ? 3250 : 1400 + plLossStreak * 500));
  // bots economy banks
  for (const b of G.bots) {
    const won = b.team === winner;
    const streak = b.team === 'CT' ? G.lossesCT : G.lossesT;
    b.money = Math.min(16000, (b.money || 800) + (won ? 3250 : 1400 + streak * 500));
  }
  dom.reBanner.textContent = winner === 'CT' ? 'Counter-Terrorists Win' : 'Terrorists Win';
  dom.reBanner.style.color = winner === 'CT' ? '#7fb2e5' : '#e5c67f';
  dom.reReason.textContent = reason;
  dom.roundEnd.classList.remove('hidden');
  (winner === 'CT' ? VOICE.win : VOICE.lose)();
  updateScoreHud();
  if (G.scoreCT >= G.winScore || G.scoreT >= G.winScore || G.round >= G.maxRounds) G.matchOver = true;
}
function afterRoundAdvance(dt) {
  G.phaseT += dt;
  if (G.phaseT < 4.5) return;
  dom.roundEnd.classList.add('hidden');
  if (G.matchOver) { showMatchEnd(); return; }
  roundEnded = false;
  G.round++;
  if (G.round === G.halftime + 1) {
    // switch sides: everyone swaps teams so teams stay balanced 5v5
    G.sidePlayer = G.sidePlayer === 'CT' ? 'T' : 'CT';
    for (const b of G.bots) {
      b.team = b.team === 'CT' ? 'T' : 'CT';
      b.inventory.secondary = b.team === 'CT' ? 'usp' : 'glock';
      b.group.remove(...b.group.children.filter(c => c.userData.gun));
    }
    announce('Смена сторон', 2.5, '#ffd23e');
  }
  beginFreeze();
}
function showMatchEnd() {
  G.phase = 'matchend';
  const ctWin = G.scoreCT > G.scoreT;
  const playerWon = (player.team === 'CT') === ctWin;
  dom.meTitle.textContent = playerWon ? 'ПОБЕДА' : 'поражение';
  dom.meTitle.style.color = playerWon ? '#3fae52' : '#c0392b';
  dom.meScore.textContent = `CT ${G.scoreCT} : ${G.scoreT} T`;
  dom.meStats.innerHTML =
    `Убийства: <b>${player.kills}</b> · Смерти: <b>${player.deaths}</b> · Хедшоты: <b>${player.hsKills}</b><br>` +
    `K/D: <b>${(player.kills / Math.max(1, player.deaths)).toFixed(2)}</b> · Потрачено: <b>$${player.spent}</b>`;
  dom.matchEnd.classList.remove('hidden');
  document.exitPointerLock?.();
}

// ------------------------------------------------------------------ HUD updates
function updateHpHud() {
  dom.hp.textContent = Math.max(0, Math.round(player.health));
  dom.ap.textContent = Math.max(0, Math.round(player.armor));
  dom.lowhp.classList.toggle('on', player.alive && player.health <= 25);
}
function updateAmmoHud() {
  const def = player.weaponDef, st = player.curState;
  dom.wpnName.textContent = def.name;
  if (def.mag === Infinity) { dom.ammoMag.textContent = '∞'; dom.ammoRes.textContent = ''; }
  else { dom.ammoMag.textContent = st ? st.mag : 0; dom.ammoRes.textContent = st ? st.reserve : 0; }
}
function updateSlotsHud() {
  dom.slotPri.classList.toggle('active', player.activeSlot === 'primary');
  dom.slotSec.classList.toggle('active', player.activeSlot === 'secondary');
  dom.slotKnife.classList.toggle('active', player.activeSlot === 'knife');
  dom.slotPri.style.opacity = player.slots.primary ? 1 : .35;
}
function updateMoneyHud() { dom.money.textContent = player.money; }
function updateScoreHud() { dom.ctScore.textContent = G.scoreCT; dom.ttScore.textContent = G.scoreT; }
function updateRoundHud() {
  dom.roundNum.textContent = `Раунд ${G.round} / ${G.maxRounds}`;
  $('ct-name').textContent = 'CT'; $('tt-name').textContent = 'T';
}
function updateTimerHud() {
  const t = Math.max(0, G.phase === 'freeze' ? G.freezeT : G.timer);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  dom.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  if (G.bomb.planted) dom.timer.textContent = `0:${String(Math.max(0, Math.ceil(G.bomb.fuseLeft))).padStart(2, '0')}`;
}
function showScoreboard(on) {
  dom.scoreboard.classList.toggle('hidden', !on);
  if (!on) return;
  const rows = (team) => {
    const list = G.bots.filter(b => b.team === team).map(b => ({ name: b.name, k: b.kills || 0, d: b.deaths || 0, hp: b.alive ? Math.round(b.health) : 0, alive: b.alive }));
    if (player.team === team) list.unshift({ name: player.name, k: player.kills, d: player.deaths, hp: player.alive ? Math.round(player.health) : 0, alive: player.alive, me: true });
    return list.map(r => `<tr class="${r.me ? 'me' : ''} ${r.alive ? '' : 'dead'}"><td>${r.name}</td><td>${r.k}</td><td>${r.d}</td><td>${r.hp}</td></tr>`).join('');
  };
  dom.sbTblCt.innerHTML = rows('CT');
  dom.sbTblTt.innerHTML = rows('T');
  dom.sbCt.textContent = G.scoreCT; dom.sbTt.textContent = G.scoreT;
}

// ------------------------------------------------------------------ radar
function drawRadar() {
  const c = radarCtx, S = 220, sc = S / (MAP_SIZE + 16);
  c.clearRect(0, 0, S, S);
  c.fillStyle = 'rgba(20,22,18,.82)'; c.fillRect(0, 0, S, S);
  const toX = x => (x + (MAP_SIZE / 2 + 8)) * sc, toY = z => (z + (MAP_SIZE / 2 + 8)) * sc;
  // walls (top-down silhouettes)
  c.strokeStyle = 'rgba(190,170,120,.5)'; c.lineWidth = 1;
  for (const b of col.solids) {
    if (b.max.y < 1) continue;
    c.strokeRect(toX(b.min.x), toY(b.min.z), (b.max.x - b.min.x) * sc, (b.max.z - b.min.z) * sc);
  }
  // bomb sites
  c.fillStyle = 'rgba(255,210,60,.8)'; c.font = 'bold 12px Arial';
  c.fillText('A', toX(BOMB_SITES.A.pos.x) - 3, toY(BOMB_SITES.A.pos.z) + 4);
  c.fillText('B', toX(BOMB_SITES.B.pos.x) - 3, toY(BOMB_SITES.B.pos.z) + 4);
  // rotate to player facing: simpler static map + rotating blip
  c.save();
  // enemies visible? classic radar shows teammates only
  for (const b of G.bots) {
    if (!b.alive) continue;
    if (b.team === player.team) {
      c.fillStyle = b.team === 'CT' ? '#7fb2e5' : '#e5c67f';
      c.beginPath(); c.arc(toX(b.pos.x), toY(b.pos.z), 3, 0, 7); c.fill();
    } else if (player.alive && botVisibleToPlayer(b)) {
      c.fillStyle = '#ff5a4e';
      c.beginPath(); c.arc(toX(b.pos.x), toY(b.pos.z), 3.4, 0, 7); c.fill();
    }
  }
  if (G.bomb.planted || (G.bomb.dropPos)) {
    const p = G.bomb.planted ? G.bomb.plantPos : G.bomb.dropPos;
    c.fillStyle = '#ff3020'; c.fillRect(toX(p.x) - 2, toY(p.z) - 2, 4, 4);
  }
  // player arrow
  const px = toX(player.pos.x), py = toY(player.pos.z);
  c.translate(px, py); c.rotate(-player.yaw);
  c.fillStyle = '#3eff56';
  c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath(); c.fill();
  c.restore();
}
const _losRay = new THREE.Raycaster();
function botVisibleToPlayer(b) {
  if (!player.alive) return false;
  const eye = player.eyePos(V(0, 0, 0));
  const tp = b.pos.clone().setY(b.pos.y + 1.3);
  const d = tp.clone().sub(eye); const dist = d.length();
  if (dist > 60) return false;
  d.normalize();
  _losRay.set(eye, d);
  const hit = rayCastWorld(_losRay, col, dist - .3);
  if (hit) return false;
  // within FOV
  const fwd = playerForward(V(0, 0, 0));
  return fwd.dot(d) > .55;
}

// ------------------------------------------------------------------ damage feedback
function updateDamageFx(dt) {
  if (!player.alive) return;
  const hurt = player.health < 100;
  if (hurt) {
    player.dmgTakenRecent += dt;
    dom.lowhp.classList.toggle('active', player.health <= 25);
  }
}

// ------------------------------------------------------------------ main loop
let lastT = nowS(), fpsAcc = 0, fpsN = 0, fpsShown = 0;
function loop() {
  requestAnimationFrame(loop);
  const t = nowS();
  let dt = Math.min(.05, t - lastT); lastT = t;

  // fps
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= .5) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; dom.fps.textContent = 'FPS: ' + fpsShown; }

  if (G.phase === 'menu' || G.phase === 'paused' || G.phase === 'matchend') {
    // idle camera drift in menu
    if (G.phase === 'menu') {
      camera.position.set(Math.sin(t * .1) * 30, 12, Math.cos(t * .1) * 30);
      camera.lookAt(0, 2, 0);
    }
    fx.update(dt);
    renderer.render(scene, camera);
    return;
  }

  // ---------- phases
  if (G.phase === 'freeze') {
    G.freezeT -= dt;
    if (G.freezeT <= 0) beginLive();
  } else if (G.phase === 'live') {
    G.timer -= dt;
    if (G.timer <= 0 && !G.bomb.planted && !roundEnded) { roundEnded = true; endRound('CT', 'Время вышло — защита победила'); }
    if (G.timer < 0) G.timer = 0;
  } else if (G.phase === 'roundend') {
    afterRoundAdvance(dt);
  }

  // ---------- entities
  if (G.phase !== 'roundend' || true) {
    updatePlayer(dt, t);
    for (const b of G.bots) {
      b.think(G, t, dt);
      if (G.phase === 'freeze') { const sv = b.state; b.state = 'objective'; b.update(G, t, dt); b.state = sv; }
      else b.update(G, t, dt);
    }
    botObjectiveActions(dt, t);
    updatePlantDefuse(dt);
    bombTick(dt, t);
    checkRoundEnd();
  }

  // player death handling
  if (!player.alive && !player._deathAnnounced) {
    player._deathAnnounced = true;
    player.deaths++;
    announce('Вы убиты — наблюдение', 2.5, '#ff5a4e');
  }
  if (player.alive) player._deathAnnounced = false;

  // dead player spectate: orbit last pos slightly
  if (!player.alive) {
    camera.position.set(player.pos.x, player.pos.y + 2.2, player.pos.z + 3);
    camera.lookAt(player.pos.x, player.pos.y + 1, player.pos.z);
    dom.scopeVig.classList.add('hidden');
  }

  updateHpHud(); updateMoneyHud(); updateTimerHud(); updateReloadBar();
  updateDamageFx(dt);
  drawRadar();
  fx.update(dt);
  renderer.render(scene, camera);
}

requestAnimationFrame(loop);

// resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
