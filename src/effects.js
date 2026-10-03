// ============ Effects: tracers, impacts, blood, muzzle flash, shell casings, smoke ============
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];   // {mesh, t, dur, from, to}
    this.impacts = [];   // {sprite, t, dur}
    this.blood = [];     // {points or sprite, vel[], t, dur}
    this.shells = [];    // {mesh, vel, angVel, t, life, grounded}
    this.flashes = [];   // {light, t}
    this.smokes = [];    // {group, t, dur}
    this.decals = [];

    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: .95 });
    this.tracerGeo = new THREE.CylinderGeometry(.012, .012, 1, 4);
    this._tracerMat = tracerMat;

    // shared impact sprite texture set in main via textures
    this.impactTex = null;
    this.bloodTex = null;
    this.flashTex = null;
    this.smokeTex = null;

    this.shellGeo = new THREE.BoxGeometry(.012, .03, .012);
    this.shellMatBrass = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: .8, roughness: .3 });
    this.shellMatSteel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: .8, roughness: .35 });
  }

  setTextures({ impact, blood, flash, smoke }) {
    this.impactTex = impact; this.bloodTex = blood; this.flashTex = flash; this.smokeTex = smoke;
  }

  // ---- tracer ----
  addTracer(from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < .1) return;
    const mesh = new THREE.Mesh(this.tracerGeo, this._tracerMat.clone());
    mesh.scale.set(1, len, 1);
    mesh.position.copy(from).add(dir.multiplyScalar(.5));
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    this.scene.add(mesh);
    this.tracers.push({ mesh, t: 0, dur: .09 });
  }

  // ---- wall impact ----
  addImpact(point, normal, isMetal = false) {
    if (!this.impactTex) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.impactTex, color: isMetal ? 0xffe0b0 : 0xd8cdb8, transparent: true, depthWrite: false
    }));
    s.position.copy(point).addScaledVector(normal, .02);
    s.scale.setScalar(.16 + Math.random() * .1);
    this.scene.add(s);
    this.impacts.push({ sprite: s, t: 0, dur: 3.2, fade: .6 });
    // spark puff
    for (let i = 0; i < 3; i++) this._spark(point, normal);
  }

  _spark(pos, normal) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffc76b, transparent: true, depthWrite: false }));
    s.position.copy(pos).addScaledVector(normal, .05);
    s.scale.setScalar(.08);
    this.scene.add(s);
    this.impacts.push({ sprite: s, t: 0, dur: .12, fade: 1 });
  }

  // ---- blood ----
  addBlood(point, dir) {
    if (!this.bloodTex) return;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bloodTex, transparent: true, depthWrite: false, opacity: .9 }));
      s.position.copy(point);
      s.scale.setScalar(.12 + Math.random() * .16);
      this.scene.add(s);
      const v = V(
        dir.x * 2 + (Math.random() - .5) * 2.4,
        1.2 + Math.random() * 1.6,
        dir.z * 2 + (Math.random() - .5) * 2.4
      );
      this.blood.push({ sprite: s, vel: v, t: 0, dur: .55 });
    }
    // decal on ground
    const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bloodTex, transparent: true, depthWrite: false, opacity: .55 }));
    d.position.copy(point).setY(Math.max(.03, point.y - .4));
    d.scale.setScalar(.5 + Math.random() * .3);
    this.scene.add(d);
    this.decals.push({ sprite: d, t: 0, dur: 12 });
  }

  // ---- muzzle flash + light ----
  muzzleFlash(origin, scale = 1) {
    if (!this.flashTex) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(origin);
    s.scale.setScalar(.35 * scale);
    this.scene.add(s);
    this.impacts.push({ sprite: s, t: 0, dur: .06, fade: 1 });
    const l = new THREE.PointLight(0xffc27a, 6 * scale, 7, 2);
    l.position.copy(origin);
    this.scene.add(l);
    this.flashes.push({ light: l, t: 0, dur: .07 });
  }

  // ---- shell casing eject ----
  ejectShell(pos, rightVec, upVec = V(0, 1, 0)) {
    const m = new THREE.Mesh(this.shellGeo, Math.random() < .5 ? this.shellMatBrass : this.shellMatSteel);
    m.position.copy(pos);
    this.scene.add(m);
    const vel = rightVec.clone().multiplyScalar(1.6 + Math.random()).add(upVec.clone().multiplyScalar(1.4 + Math.random()));
    this.shells.push({
      mesh: m, vel, angVel: V((Math.random() - .5) * 20, (Math.random() - .5) * 20, (Math.random() - .5) * 20),
      t: 0, life: 6, grounded: false, restY: pos.y - .5
    });
  }

  // ---- smoke grenade visual cloud ----
  addSmoke(pos) {
    const g = new THREE.Group();
    g.position.copy(pos);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.position.set((Math.random() - .5) * 3, Math.random() * 1.6, (Math.random() - .5) * 3);
      s.scale.setScalar(2.6 + Math.random() * 1.6);
      g.add(s);
    }
    this.scene.add(g);
    this.smokes.push({ group: g, t: 0, dur: 18 });
    return g;
  }

  update(dt, gravity = 16) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const o = this.tracers[i]; o.t += dt;
      o.mesh.material.opacity = .95 * (1 - o.t / o.dur);
      if (o.t >= o.dur) { this.scene.remove(o.mesh); o.mesh.material.dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const o = this.impacts[i]; o.t += dt;
      const f = o.fade || 1;
      if (o.t > o.dur * f) o.sprite.material.opacity = Math.max(0, (1 - (o.t - o.dur * f) / (o.dur * (1 - f))) * o.sprite.userData.baseOpacity ?? .8);
      if (o.t >= o.dur) { this.scene.remove(o.sprite); o.sprite.material.dispose(); this.impacts.splice(i, 1); }
    }
    for (let i = this.blood.length - 1; i >= 0; i--) {
      const o = this.blood[i]; o.t += dt;
      o.vel.y -= gravity * dt;
      o.sprite.position.addScaledVector(o.vel, dt);
      if (o.sprite.position.y < .02) { o.sprite.position.y = .02; o.vel.set(0, 0, 0); }
      o.sprite.material.opacity = .9 * (1 - o.t / o.dur);
      if (o.t >= o.dur) { this.scene.remove(o.sprite); o.sprite.material.dispose(); this.blood.splice(i, 1); }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const o = this.decals[i]; o.t += dt;
      if (o.t > o.dur - 2) o.sprite.material.opacity = .55 * (1 - (o.t - (o.dur - 2)) / 2);
      if (o.t >= o.dur) { this.scene.remove(o.sprite); o.sprite.material.dispose(); this.decals.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const o = this.flashes[i]; o.t += dt;
      o.light.intensity = 6 * (1 - o.t / o.dur);
      if (o.t >= o.dur) { this.scene.remove(o.light); this.flashes.splice(i, 1); }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const o = this.shells[i]; o.t += dt;
      if (!o.grounded) {
        o.vel.y -= gravity * dt;
        o.mesh.position.addScaledVector(o.vel, dt);
        o.mesh.rotation.x += o.angVel.x * dt; o.mesh.rotation.y += o.angVel.y * dt; o.mesh.rotation.z += o.angVel.z * dt;
        if (o.mesh.position.y <= o.restY) { o.grounded = true; o.mesh.position.y = o.restY; }
      }
      if (o.t >= o.life) { this.scene.remove(o.mesh); this.shells.splice(i, 1); }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const o = this.smokes[i]; o.t += dt;
      const kids = o.group.children;
      for (let j = 0; j < kids.length; j++) {
        const s = kids[j];
        let op;
        if (o.t < 1.2) op = (o.t / 1.2) * .8;
        else if (o.t > o.dur - 3) op = Math.max(0, ((o.dur - o.t) / 3)) * .8;
        else op = .8;
        s.material.opacity = op * (.7 + .3 * Math.sin(o.t * .8 + j));
        s.position.y += dt * .05;
        s.position.x += Math.sin(o.t * .3 + j * 2) * dt * .1;
      }
      if (o.t >= o.dur) {
        for (const s of kids) { this.scene.remove(s); s.material.dispose(); }
        this.scene.remove(o.group);
        this.smokes.splice(i, 1);
      }
    }
  }
}

// simple impact dot texture
export function impactTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(.3, 'rgba(210,200,180,.8)');
  g.addColorStop(1, 'rgba(180,170,150,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(40,35,28,.9)';
  x.beginPath(); x.arc(32, 32, 6, 0, 7); x.fill();
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * 7, r = 8 + Math.random() * 14;
    x.beginPath(); x.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1.5 + Math.random() * 2, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
