// ============ Weapons: stats, viewmodels, worldmodels, sounds ============
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- sound synthesis ----------
let _actx = null;
export function audioCtx() {
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  return _actx;
}
export function resumeAudio() { const c = audioCtx(); if (c.state === 'suspended') c.resume(); }

function noiseBuffer(ctx, dur) {
  const b = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function shotBase(opts = {}) {
  const { dur = .16, lp = 2600, hp = 320, vol = .5, tail = .07, tone = 0 } = opts;
  const ctx = audioCtx();
  const t = ctx.currentTime;
  const out = ctx.createGain(); out.gain.value = vol; out.connect(ctx.destination);

  // noise crack
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur + tail);
  const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.setValueAtTime(lp, t);
  lpf.frequency.exponentialRampToValueAtTime(420, t + dur + tail);
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(.001, t + dur + tail);
  src.connect(lpf); lpf.connect(hpf); hpf.connect(g); g.connect(out);
  src.start(t); src.stop(t + dur + tail + .02);

  // low thump
  const osc = ctx.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(150 + tone, t);
  osc.frequency.exponentialRampToValueAtTime(46 + tone / 2, t + .09);
  const og = ctx.createGain();
  og.gain.setValueAtTime(.85, t); og.gain.exponentialRampToValueAtTime(.001, t + .12);
  osc.connect(og); og.connect(out); osc.start(t); osc.stop(t + .14);
}

function click(freq = 1800, vol = .12, dur = .04) {
  const ctx = audioCtx(); const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.6;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + dur + .01);
}

function beepSeq(notes, vol = .16, type = 'square', dur = .12) {
  const ctx = audioCtx();
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ctx.createGain(); const t = ctx.currentTime + i * dur;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur * .9);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur);
  });
}

// ---------- weapon definitions ----------
export const WEAPONS = {
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 'primary', price: 2700, team: 'both',
    mag: 30, reserve: 90, rpm: 600, dmg: 36, headMul: 4.2, armormul: .47,
    recoilKick: V(0, .010, .024), recoilSide: .0062, moveSpread: .055, airSpread: .3,
    reloadTime: 2.43, switchTime: .55, range: 300, falloffStart: 60, falloffEnd: 120, minDmgMul: .72,
    pellets: 1, fire(mode) { return mode === 'auto'; },
    sound() { shotBase({ dur: .13, lp: 3200, hp: 300, vol: .5, tail: .09, tone: 30 }); },
    reloadSound() { click(1200, .1); setTimeout(() => click(900, .1), 180); setTimeout(() => click(2200, .14), 620); },
    buildVM: buildAK, buildWM: buildAKWorld, vmScale: 1, wmScale: 1
  },
  m4a4: {
    id: 'm4a4', name: 'M4A4', slot: 'primary', price: 3100, team: 'both',
    mag: 30, reserve: 90, rpm: 666, dmg: 33, headMul: 4.0, armormul: .4,
    recoilKick: V(0, .008, .019), recoilSide: .0048, moveSpread: .05, airSpread: .3,
    reloadTime: 3.1, switchTime: .55, range: 300, falloffStart: 65, falloffEnd: 130, minDmgMul: .75,
    pellets: 1, fire(mode) { return mode === 'auto'; },
    sound() { shotBase({ dur: .11, lp: 3800, hp: 420, vol: .46, tail: .07, tone: 40 }); },
    reloadSound() { click(1300, .1); setTimeout(() => click(2300, .14), 700); },
    buildVM: buildM4, buildWM: buildM4World, vmScale: 1, wmScale: 1
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 'primary', price: 4750, team: 'both',
    mag: 10, reserve: 30, rpm: 41, dmg: 115, headMul: 2.5, armormul: .5,
    recoilKick: V(0, .05, .09), recoilSide: .002, moveSpread: .18, airSpread: .5,
    reloadTime: 3.7, switchTime: .8, range: 400, falloffStart: 120, falloffEnd: 250, minDmgMul: .9,
    pellets: 1, scoped: true, fire(mode) { return mode === 'semi' || mode === 'single'; },
    sound() { shotBase({ dur: .22, lp: 2200, hp: 160, vol: .6, tail: .3, tone: 18 }); setTimeout(() => click(600, .08, .1), 120); },
    reloadSound() { click(1000, .12); setTimeout(() => click(1600, .12), 400); setTimeout(() => click(2400, .16), 900); },
    scopeIn() { click(2600, .08, .06); }, scopeOut() { click(1700, .06, .05); },
    buildVM: buildAWP, buildWM: buildAWPWorld, vmScale: 1, wmScale: 1
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 'secondary', price: 700, team: 'both',
    mag: 7, reserve: 35, rpm: 267, dmg: 63, headMul: 4, armormul: .27,
    recoilKick: V(0, .03, .05), recoilSide: .01, moveSpread: .07, airSpread: .35,
    reloadTime: 2.2, switchTime: .4, range: 200, falloffStart: 40, falloffEnd: 100, minDmgMul: .7,
    pellets: 1, fire(mode) { return mode === 'semi'; },
    sound() { shotBase({ dur: .16, lp: 2800, hp: 240, vol: .55, tail: .12, tone: 60 }); },
    reloadSound() { click(1500, .1); setTimeout(() => click(2500, .13), 500); },
    buildVM: buildDeagle, buildWM: buildDeagleWorld, vmScale: .9, wmScale: 1
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 'secondary', price: 200, team: 'T',
    mag: 20, reserve: 120, rpm: 400, dmg: 30, headMul: 4, armormul: .35,
    recoilKick: V(0, .008, .016), recoilSide: .006, moveSpread: .04, airSpread: .3,
    reloadTime: 2.2, switchTime: .4, range: 150, falloffStart: 25, falloffEnd: 80, minDmgMul: .65,
    pellets: 1, fire(mode) { return mode === 'semi'; },
    sound() { shotBase({ dur: .08, lp: 3400, hp: 500, vol: .34, tail: .05, tone: 80 }); },
    reloadSound() { click(1400, .08); setTimeout(() => click(2100, .1), 480); },
    buildVM: buildGlock, buildWM: buildGlockWorld, vmScale: .95, wmScale: 1
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 'secondary', price: 200, team: 'CT',
    mag: 12, reserve: 24, rpm: 352, dmg: 35, headMul: 4, armormul: .4,
    recoilKick: V(0, .007, .014), recoilSide: .005, moveSpread: .035, airSpread: .3,
    reloadTime: 2.1, switchTime: .4, range: 160, falloffStart: 30, falloffEnd: 90, minDmgMul: .68,
    pellets: 1, fire(mode) { return mode === 'semi'; },
    sound() { shotBase({ dur: .07, lp: 2600, hp: 600, vol: .3, tail: .05, tone: 90 }); },
    reloadSound() { click(1400, .08); setTimeout(() => click(2100, .1), 460); },
    buildVM: buildUSP, buildWM: buildUSPWorld, vmScale: .95, wmScale: 1
  },
  knife: {
    id: 'knife', name: 'Knife', slot: 'knife', price: 0, team: 'both',
    mag: Infinity, reserve: 0, rpm: 180, dmg: 55, headMul: 3.5, armormul: 1,
    recoilKick: V(0, 0, 0), recoilSide: 0, moveSpread: 0, airSpread: 0,
    reloadTime: 0, switchTime: .45, range: 2.2, melee: true,
    fire(mode) { return mode === 'semi' || mode === 'single'; },
    sound() { click(3200, .1, .07); setTimeout(() => click(2400, .06, .05), 40); },
    slashSound() { const ctx = audioCtx(); const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, .12);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(3400, t + .1); bp.Q.value = .8;
      const g = ctx.createGain(); g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .13);
      s.connect(bp); bp.connect(g); g.connect(ctx.destination); s.start(t); s.stop(t + .15); },
    buildVM: buildKnife, buildWM: null, vmScale: 1.05, wmScale: 1
  }
};

// announcer voice cues (stylized beeps — no copyrighted audio)
export const VOICE = {
  bombPlanted() { beepSeq([660, 520, 660], .12, 'sine', .14); },
  roundStart() { beepSeq([440, 660], .1, 'triangle', .1); },
  headshot() { click(4200, .16, .05); },
  win() { beepSeq([523, 659, 784, 1046], .12, 'triangle', .16); },
  lose() { beepSeq([400, 320, 240], .1, 'sawtooth', .18); },
  noBuy() { click(300, .12, .12); }
};

// ---------- material helpers ----------
const matCache = {};
function gunMat(color, metalness = .75, roughness = .35) {
  const key = color + '|' + metalness + '|' + roughness;
  if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  return matCache[key];
}
const WOOD = () => gunMat('#7a5a30', .1, .7);
const POLY = (c) => gunMat(c, .2, .55);

function box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  return m;
}
function cyl(rt, rb, len, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  return m;
}

// ---------- builders (local space: -Z forward, +Y up, +X right) ----------
function buildAK() {
  const g = new THREE.Group();
  const body = gunMat('#2b2b2e'); const wood = WOOD(); const dark = gunMat('#17171a');
  g.add(box(.07, .09, .52, body, 0, 0, -.1));                 // receiver
  g.add(box(.055, .045, .5, dark, 0, .015, -.62));            // handguard lower
  g.add(box(.062, .03, .34, wood, 0, .055, -.58));            // upper handguard wood
  const barrel = cyl(.017, .017, .5, dark); barrel.position.set(0, .02, -.95); g.add(barrel);
  const ps = cyl(.026, .026, .1, gunMat('#3a3a3d')); ps.position.set(0, .02, -1.18); g.add(ps); // muzzle brake
  const gasTube = cyl(.012, .012, .3, dark); gasTube.position.set(0, .075, -.6); g.add(gasTube);
  const mag = box(.05, .17, .09, gunMat('#241d15'), 0, -.11, -.12, .28); g.add(mag); // curved banana
  const mag2 = box(.05, .1, .08, gunMat('#241d15'), 0, -.19, -.06, .55); g.add(mag2);
  g.add(box(.02, .05, .02, body, 0, .075, .12));              // rear sight
  g.add(box(.015, .045, .015, body, 0, .06, -1.12));          // front post
  g.add(box(.055, .07, .16, wood, 0, -.02, .28, .12));        // stock
  g.add(box(.05, .09, .1, wood, 0, -.06, .06, .35));          // pistol grip
  const pump = box(.05, .035, .12, wood, 0, -.03, -.75); g.add(pump);
  g.userData.muzzle = V(0, .02, -1.26);
  return g;
}
function buildM4() {
  const g = new THREE.Group();
  const body = gunMat('#26262a'); const dark = gunMat('#141416'); const poly = POLY('#1d1d20');
  g.add(box(.065, .085, .46, body, 0, 0, -.08));
  g.add(box(.05, .055, .34, poly, 0, .005, -.55));            // rail handguard
  for (let i = 0; i < 5; i++) g.add(box(.054, .012, .03, dark, 0, .036, -.44 - i * .06));
  const barrel = cyl(.015, .015, .42, dark); barrel.position.set(0, .01, -.9); g.add(barrel);
  const comp = cyl(.022, .022, .09, gunMat('#3c3c40')); comp.position.set(0, .01, -1.1); g.add(comp); // compensator
  const mag = box(.045, .16, .075, gunMat('#2c2c30'), 0, -.11, -.05, .06); g.add(mag);
  g.add(box(.03, .05, .03, dark, 0, .075, .1));               // carry handle rear
  g.add(box(.02, .055, .02, dark, 0, .07, -1.02));            // front sight A-frame
  g.add(box(.05, .06, .18, poly, 0, -.005, .3));              // telescoping stock
  g.add(box(.045, .085, .09, poly, 0, -.06, .04, .3));        // grip
  g.userData.muzzle = V(0, .01, -1.16);
  return g;
}
function buildAWP() {
  const g = new THREE.Group();
  const body = gunMat('#20361f', .5, .5); const green = gunMat('#33502f', .3, .6);
  const dark = gunMat('#101012');
  g.add(box(.06, .08, .5, body, 0, 0, -.05));
  g.add(box(.05, .06, .55, green, 0, -.005, -.62));           // fore-end
  const barrel = cyl(.016, .016, .72, dark); barrel.position.set(0, .02, -1.02); g.add(barrel);
  const br = cyl(.024, .024, .12, dark); br.position.set(0, .02, -1.38); g.add(br); // brake
  const scope = cyl(.028, .028, .3, gunMat('#0c0c0e', .8, .3)); scope.position.set(0, .09, -.1); g.add(scope);
  const lens = cyl(.03, .03, .01, gunMat('#123a5e', .1, .15)); lens.position.set(0, .09, -.252); g.add(lens);
  g.add(box(.02, .04, .05, dark, 0, .06, -.02));              // scope mount
  const mag = box(.045, .09, .1, green, 0, -.075, -.1); g.add(mag);
  g.add(box(.05, .07, .22, green, 0, -.01, .28, .1));         // stock w/ cheek rest
  g.add(box(.045, .05, .06, green, 0, -.09, .22));            // thumbhole bottom
  g.add(box(.04, .08, .08, gunMat('#1a1a1c'), 0, -.055, .02, .3)); // grip
  g.userData.muzzle = V(0, .02, -1.46);
  return g;
}
function buildDeagle() {
  const g = new THREE.Group();
  const steel = gunMat('#8f8f96', .9, .25); const dark = gunMat('#2a2a2e', .8, .35);
  g.add(box(.045, .075, .24, steel, 0, .01, -.06));           // slide
  g.add(box(.045, .03, .18, dark, 0, -.045, -.02));           // frame
  const barrel = cyl(.014, .014, .13, steel); barrel.position.set(0, .012, -.24); g.add(barrel);
  g.add(box(.04, .09, .05, dark, 0, -.08, .04, .28));         // grip
  const mag = box(.036, .07, .04, gunMat('#55555c'), 0, -.1, .05, .28); g.add(mag);
  g.add(box(.012, .02, .012, steel, 0, .055, -.14));          // rear sight
  g.add(box(.01, .018, .01, steel, 0, .05, -.28));            // front
  g.userData.muzzle = V(0, .012, -.31);
  return g;
}
function buildGlock() {
  const g = new THREE.Group();
  const slide = gunMat('#232326', .6, .4); const frame = POLY('#2e2e33');
  g.add(box(.038, .05, .19, slide, 0, .015, -.04));
  g.add(box(.036, .04, .16, frame, 0, -.02, -.01));
  g.add(box(.034, .085, .04, frame, 0, -.07, .02, .1));       // grip
  const mag = box(.03, .07, .032, gunMat('#1a1a1d'), 0, -.09, .025, .1); g.add(mag);
  g.add(box(.008, .014, .008, slide, 0, .045, -.12));         // front sight
  g.add(box(.02, .012, .012, slide, 0, .043, .03));           // rear
  g.userData.muzzle = V(0, .015, -.15);
  return g;
}
function buildUSP() {
  const g = new THREE.Group();
  const slide = gunMat('#1c1c1f', .55, .42); const frame = POLY('#37373c');
  g.add(box(.04, .055, .2, slide, 0, .015, -.05));
  g.add(box(.037, .042, .16, frame, 0, -.02, -.01));
  g.add(box(.036, .09, .045, frame, 0, -.075, .02, .12));     // grip w/ beavertail
  const mag = box(.032, .075, .034, gunMat('#141416'), 0, -.095, .03, .12); g.add(mag);
  const sup = cyl(.02, .02, .12, gunMat('#242427', .7, .35)); sup.position.set(0, .015, -.22); g.add(sup); // suppressor
  g.add(box(.01, .016, .01, slide, 0, .05, -.13));
  g.userData.muzzle = V(0, .015, -.29);
  return g;
}
function buildKnife() {
  const g = new THREE.Group();
  const steel = gunMat('#b9bec6', .95, .18); const handle = POLY('#26262a');
  const blade = box(.012, .045, .26, steel, 0, .01, -.16, 0, 0, 0);
  blade.geometry.translate(0, 0, -.02);
  g.add(blade);
  // spear point tip
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.024, .07, 4), steel);
  tip.rotation.x = -Math.PI / 2; tip.position.set(0, .01, -.32); g.add(tip);
  g.add(box(.035, .055, .11, handle, 0, -.005, .06));
  g.add(box(.05, .012, .02, gunMat('#8f8f96'), 0, .01, .005)); // guard
  g.userData.muzzle = V(0, .01, -.34);
  return g;
}

// world model variants (slightly chunkier, shared geometry ok)
function wrapWorld(build) { return function () { const g = build(); g.scale.setScalar(1); return g; }; }
const buildAKWorld = wrapWorld(buildAK);
const buildM4World = wrapWorld(buildM4);
const buildAWPWorld = wrapWorld(buildAWP);
const buildDeagleWorld = wrapWorld(buildDeagle);
const buildGlockWorld = wrapWorld(buildGlock);
const buildUSPWorld = wrapWorld(buildUSP);

// ---------- viewmodel animation ----------
export class ViewModelAnim {
  constructor(camera) {
    this.camera = camera;
    this.hipGroup = new THREE.Group();   // holds current weapon at hip position
    camera.add(this.hipGroup);
    this.current = null;                  // {group, def, anim state}
    this.basePos = V(.16, -.15, -.32);
    this.baseRot = V(0, .06, 0);
    this.recoilPos = V(0, 0, 0);
    this.recoilRot = V(0, 0, 0);
    this.sway = V(0, 0, 0);
    this.bobPhase = 0;
    this.reloadT = -1;
    this.reloadDur = 1;
    this.switchT = -1;
    this.switchDur = .5;
    this.nextDef = null;
    this.pumping = 0;
    this.slashT = -1;
  }

  equip(def, instant = false) {
    if (this.current) { this.hipGroup.remove(this.current.group); disposeGroup(this.current.group); }
    const g = def.buildVM ? def.buildVM() : null;
    if (g) {
      g.scale.setScalar(def.vmScale || 1);
      g.rotation.set(0, Math.PI, 0); // face forward relative to camera group children (-z is already forward; keep gun pointing -z but flip so it looks natural)
      g.rotation.set(0, 0, 0);
      this.hipGroup.add(g);
    }
    this.current = { group: g, def };
    this.recoilPos.set(0, 0, 0); this.recoilRot.set(0, 0, 0);
    if (!instant) { this.switchT = 0; this.switchDur = def.switchTime; }
  }

  startReload(dur) { this.reloadT = 0; this.reloadDur = dur; }
  cancelReload() { this.reloadT = -1; }
  startSwitch(def) { this.nextDef = def; this.switchT = 0; this.switchDur = Math.max(.25, def.switchTime * .5); }
  addRecoil(kick) {
    this.recoilPos.z += kick.z * 2.2;
    this.recoilPos.y += kick.y * 1.2;
    this.recoilRot.x += kick.z * 1.6;
    this.recoilRot.y += (Math.random() - .5) * kick.x * 6;
  }
  slash() { this.slashT = 0; }

  update(dt, speedFrac, moving, scoped) {
    if (!this.current) return;
    const grp = this.hipGroup;
    // auto-recover recoil offsets
    const k = Math.min(1, dt * 10);
    this.recoilPos.multiplyScalar(1 - k);
    this.recoilRot.multiplyScalar(1 - k);
    // walk bob
    if (moving && !scoped) {
      this.bobPhase += dt * (6 + speedFrac * 6);
    } else {
      this.bobPhase += dt * .6;
    }
    const bobA = moving ? .012 + speedFrac * .012 : .003;
    const bx = Math.sin(this.bobPhase) * bobA;
    const by = -Math.abs(Math.cos(this.bobPhase)) * bobA * .9;

    let px = this.basePos.x + bx + this.recoilPos.x;
    let py = this.basePos.y + by + this.recoilPos.y;
    let pz = this.basePos.z + this.recoilPos.z;
    let rx = this.baseRot.x + this.recoilRot.x;
    let ry = this.baseRot.y + this.recoilRot.y;
    let rz = Math.sin(this.bobPhase * .5) * .008 + this.recoilRot.z;

    // reload animation: dip down & rotate
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const t = Math.min(1, this.reloadT / this.reloadDur);
      const dip = Math.sin(t * Math.PI);
      py -= dip * .22; pz += dip * .08; rx += dip * .9; rz += dip * .35;
      if (t >= 1) { this.reloadT = -1; }
    }
    // switch animation
    if (this.switchT >= 0) {
      this.switchT += dt;
      const t = Math.min(1, this.switchT / this.switchDur);
      const drop = Math.sin(t * Math.PI);
      py -= drop * .3; ry += drop * .7;
      if (t >= 1) {
        this.switchT = -1;
        if (this.nextDef) { const d = this.nextDef; this.nextDef = null; this.equip(d, true); }
      }
    }
    // knife slash
    if (this.slashT >= 0) {
      this.slashT += dt;
      const t = Math.min(1, this.slashT / .3);
      const s = Math.sin(t * Math.PI);
      px -= s * .12; ry -= s * 1.2; rz += s * .8; pz += s * .1;
      if (t >= 1) this.slashT = -1;
    }
    // pump action after shotgun-like shots (unused) 
    if (this.pumping > 0) this.pumping -= dt;

    // scoped hide (AWP hides hip model when zoomed)
    grp.visible = !(scoped && this.current.def.scoped);

    grp.position.set(px, py, pz);
    grp.rotation.set(rx, ry, rz);
  }
}

export function disposeGroup(g) {
  g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
}
