// ============ de_dust2-style map: geometry, colliders, navmesh, spawns ============
import * as THREE from 'three';
import { sandFloorTex, dustWallTex, darkWallTex, crateTex, tileFloorTex } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const MAP_SIZE = 96;      // playable extent roughly -48..48
export const BOMB_SITES = {
  A: { pos: V(18, 0, -18), radius: 5 },
  B: { pos: V(-24, 0, 22), radius: 5 }
};
export const SPAWNS = {
  T: [V(34, 0, 36), V(37, 0, 33), V(31, 0, 39), V(38, 0, 38), V(33, 0, 33.5)],
  CT: [V(-34, 0, -34), V(-37, 0, -31), V(-31, 0, -37), V(-38, 0, -36), V(-33.5, 0, -33)]
};
// key waypoints for bot navigation
export const WPTS = {
  tspawn: V(34.5, 0, 36), longA: V(20, 0, 34), longMid: V(6, 0, 22), midDoors: V(0, 0, 10),
  catwalk: V(-4, 0, -4), upper: V(-10, 0, -16), ctspawn: V(-34.5, 0, -34),
  siteA: V(18, 0, -18), siteAtop: V(14, 0, -14), pitA: V(24, 0, -8),
  tunnelOut: V(-22, 0, 8), connB: V(-22, 0, 16), siteB: V(-24, 0, 22),
  bDoors: V(-12, 0, 30), bLong: V(-18, 0, 38), window: V(10, 0, 2), windowspot: V(8, 0, 6)
};

// ---------- collision registry ----------
export class Colliders {
  constructor() { this.solids = []; this.stands = []; } // stands: full boxes incl. floors of elevated stuff
  addSolid(min, max) { this.solids.push({ min, max }); }
  addStand(min, max) { this.stands.push({ min, max }); }
}

export function buildMap(scene) {
  const col = new Colliders();
  const root = new THREE.Group();
  scene.add(root);

  const texDust = dustWallTex(1);
  const texDark = darkWallTex(1);
  const texCrate = crateTex(1);
  const texSand = sandFloorTex(72);
  const texTile = tileFloorTex(24);

  const matDust = new THREE.MeshStandardMaterial({ map: texDust, roughness: .95, metalness: 0 });
  const matDark = new THREE.MeshStandardMaterial({ map: texDark, roughness: .95, metalness: 0 });
  const matCrate = new THREE.MeshStandardMaterial({ map: texCrate, roughness: .8, metalness: .05 });
  const matBigCrate = new THREE.MeshStandardMaterial({ map: texCrate.clone(), roughness: .8, metalness: .05 });
  matBigCrate.map.repeat.set(2, 2); matBigCrate.map.needsUpdate = true;
  const matSand = new THREE.MeshStandardMaterial({ map: texSand, roughness: 1, metalness: 0 });
  const matTile = new THREE.MeshStandardMaterial({ map: texTile, roughness: .9, metalness: 0 });
  const matBox = new THREE.MeshStandardMaterial({ color: 0x9b8258, roughness: 1 });

  // floor slabs (visual only, walkable via ground plane; raised floors registered as stands)
  function floor(w, d, x, z, mat = null, y = 0.02) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat || matSand);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    m.receiveShadow = true; root.add(m); return m;
  }
  // main box wall — thin visual, thick collider so nothing escapes
  function wallX(x, z1, z2, h = 7, t = 1, mat = null, y0 = 0) {
    const len = Math.abs(z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, h, len), mat || matDust);
    m.position.set(x, y0 + h / 2, (z1 + z2) / 2);
    m.castShadow = true; m.receiveShadow = true; root.add(m);
    col.addSolid(V(x - t / 2 - .5, y0, Math.min(z1, z2) - .5), V(x + t / 2 + .5, y0 + h, Math.max(z1, z2) + .5));
    return m;
  }
  function wallZ(z, x1, x2, h = 7, t = 1, mat = null, y0 = 0) {
    const len = Math.abs(x2 - x1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), mat || matDust);
    m.position.set((x1 + x2) / 2, y0 + h / 2, z);
    m.castShadow = true; m.receiveShadow = true; root.add(m);
    col.addSolid(V(Math.min(x1, x2) - .5, y0, z - t / 2 - .5), V(Math.max(x1, x2) + .5, y0 + h, z + t / 2 + .5));
    return m;
  }
  // generic block with optional stand surface
  function block(cx, cz, w, h, d, opts = {}) {
    const { mat = matBox, solid = true, stand = true, y0 = 0 } = opts;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, y0 + h / 2, cz);
    m.castShadow = true; m.receiveShadow = true; root.add(m);
    const pad = solid ? .35 : 0;
    if (solid) col.addSolid(V(cx - w / 2 - pad, y0, cz - d / 2 - pad), V(cx + w / 2 + pad, y0 + h, cz + d / 2 + pad));
    if (stand && h >= .5) col.addStand(V(cx - w / 2, y0, cz - d / 2), V(cx + w / 2, y0 + h, cz + d / 2));
    return m;
  }
  function crate(x, z, s = 1.6, y0 = 0, rot = 0) {
    const m = block(x, z, s, s, s, { mat: s > 2.2 ? matBigCrate : matCrate });
    m.rotation.y = rot;
    return m;
  }

  // =================== GROUND ===================
  floor(150, 150, 0, 0);
  floor(26, 20, 18, -18, matTile);   // site A tiles
  floor(20, 16, -24, 22, matTile);   // site B tiles
  floor(14, 14, 34.5, 36, matTile);  // T spawn
  floor(14, 14, -34.5, -34, matTile);// CT spawn

  // =================== OUTER BORDER ===================
  wallX(-48, -48, 48, 10); wallX(48, -48, 48, 10);
  wallZ(-48, -48, 48, 10); wallZ(48, -48, 48, 10);

  // =================== LONG A CORRIDOR (T side -> site A) ===================
  // south-east corridor along x=20..34, z=27..44
  wallZ(27, 20, 34, 6, 1, matDust);       // long north wall (with doors gap handled below)
  // rebuild that wall with a door gap at x=26..29:
  root.children.pop(); // remove last mesh
  col.solids.pop();    // and its collider
  wallZ(27, 20, 26, 6, 1, matDust);
  wallZ(27, 29, 34, 6, 1, matDust);
  // double doors in the gap (closed but jumpable)
  block(26.6, 27, 1.2, 1.9, .8, { mat: matCrate, stand: true });
  block(28.4, 27, 1.2, 1.9, .8, { mat: matCrate, stand: true });
  wallX(20, 27, 44, 6, 1, matDust);       // long west wall
  wallX(34, 27, 44, 6, 1, matDark);       // long east wall (dark)
  // pillars in long
  block(27, 33, 1.2, 6, 1.2, { mat: matDark, stand: false });
  block(27, 39, 1.2, 6, 1.2, { mat: matDark, stand: false });
  // crates near doors for boost
  crate(24.6, 29.6, 1.6); crate(24.6, 29.6, 1.6, 1.6);
  crate(31, 30, 1.6);
  // "Tetris" near site A entry
  crate(20, 24, 1.6); crate(21.7, 24, 1.6); crate(20, 22.2, 1.6); crate(20.8, 23, 1.6, 1.6);

  // =================== SITE A ===================
  wallZ(-28, 8, 14, 6, 1, matDust);        // back of site A (north)
  wallZ(-28, 22, 30, 6, 1, matDust);       // NE corner piece
  wallX(30, -28, -6, 6, 1, matDust);       // east side of site toward pit
  // site platforms (raised bomb platform)
  block(18, -18, 9, .5, 9, { mat: matTile });
  // A "main"/temple columns
  block(12, -24, 1.4, 6, 1.4, { mat: matDark, stand: false });
  block(12, -12, 1.4, 6, 1.4, { mat: matDark, stand: false });
  // crates on site
  crate(14, -22, 1.6); crate(15.7, -22, 1.6); crate(14.8, -22, 1.6, 1.6);
  crate(22, -14, 1.6); crate(22, -14, 1.6, 1.6, .4);
  crate(24, -20, 2.8);           // big box
  crate(12, -16, 1.6);
  // generator hut on site
  block(20, -25, 4, 2.6, 2.4, { mat: matDark });
  block(20, -25, 4.4, .4, 2.8, { mat: matBox }); // roof ledge trim (same top)

  // pit / hole edge walls around (24..30, -8..-2): rim so it reads as a lower area
  wallX(30, -8, 0, 4, 1, matDark);
  wallZ(0, 24, 30, 4, 1, matDark);
  block(27, -4, 6, .3, 6, { mat: matSand, solid: false, stand: true }); // slightly sunken pit floor look

  // =================== MID: DOORS & CATWALK ===================
  // doors from mid to long (wall across x=-2..? ) — wall segment pair at z=18 diagonal-ish; simplify vertical wall x=6
  wallX(6, 14, 26, 6, 1, matDust);   // mid/long divider
  // double doors (jumpable) at z 18..22 gap in that wall:
  root.children.pop(); col.solids.pop();
  wallX(6, 14, 18, 6, 1, matDust);
  wallX(6, 22, 26, 6, 1, matDust);
  block(6, 18.6, .8, 1.9, 1.2, { mat: matCrate });
  block(6, 21.4, .8, 1.9, 1.2, { mat: matCrate });
  // small step crate to boost over doors
  crate(4.6, 20, 1.6);

  // catwalk walls: corridor between x=-6..-1 from z ~ -10..10
  wallX(-1, -12, 10, 6, 1, matDust);   // catwalk east wall (faces mid)
  wallX(-6, -12, 6, 6, 1, matDark);    // catwalk west wall
  // catwalk exit toward upper/CT
  wallZ(-12, -6, -2, 6, 1, matDust);
  // boxes in catwalk
  crate(-3.5, 6, 1.6); crate(-3.5, 6, 1.6, 1.6); crate(-3.5, -6, 1.6);

  // mid connector wall from doors to T side (east of catwalk)
  wallZ(10, -1, 6, 6, 1, matDust);

  // =================== UPPER / CT SPAWN AREA ===================
  wallX(-14, -30, -14, 6, 1, matDust);  // upper west
  wallZ(-24, -24, -14, 6, 1, matDust);  // upper north stub
  wallX(-24, -30, -24, 6, 1, matDark);
  // CT spawn walls
  wallZ(-40, -44, -28, 6, 1, matDust);
  wallX(-44, -44, -28, 6, 1, matDust);
  // ramp up visual: stacked blocks (CT is higher by steps)
  block(-34.5, -30, 12, .4, 6, { mat: matTile, solid: false });
  block(-34.5, -34, 12, .8, 6, { mat: matTile, solid: false });
  crate(-28, -28, 1.6);

  // =================== TUNNELS TO B ===================
  // from upper (-10,-16) heading SW into tunnel mouth at (-16,-22)
  wallX(-16, -30, -20, 6, 1, matDark);
  wallZ(-20, -24, -16, 6, 1, matDark);
  // tunnel: two parallel walls going down-left to (-34,8) then to B connector
  wallZ(-14, -34, -22, 7, 1.2, matDark); // north wall of tunnel (tunnel below y? keep full height)
  wallZ(-22, -34, -22, 7, 1.2, matDark); // south wall
  // tunnel ceiling (dark interior feel)
  block(-28, -18, 12.4, .6, 9.4, { mat: matDark, solid: false, stand: false });
  root.children[root.children.length - 1].position.y = 6.4;
  // bend: vertical walls guiding to B doors
  wallX(-34, -22, -12, 6, 1.2, matDark);
  // open doorway in north tunnel wall at z=-14 x -26..-22 blocked partially: leave gap handled by segments
  root.children.pop(); col.solids.pop();
  wallZ(-14, -34, -27, 7, 1.2, matDark);
  wallZ(-14, -23, -22, 7, 1.2, matDark);

  // B doors (double, jumpable) at x=-14..-10 z=30 wall
  wallZ(30, -30, -18, 6, 1, matDust);
  root.children.pop(); col.solids.pop();
  wallZ(30, -30, -16.5, 6, 1, matDust);
  wallZ(30, -13.5, -6, 6, 1, matDust);
  block(-15, 30, 1.4, 1.9, .9, { mat: matCrate });
  block(-15, 30, 1.4, 1.9, .9, { mat: matCrate, y0: 0 });
  // shift second door leaf
  root.children[root.children.length - 1].position.x = -15;
  root.children[root.children.length - 1].position.z = 30;
  // step crate outside doors
  crate(-17.5, 32.5, 1.6); crate(-17.5, 32.5, 1.6, 1.6);

  // =================== SITE B ===================
  wallX(-32, 14, 26, 6, 1, matDust);     // B west
  wallZ(26, -32, -28, 6, 1, matDust);    // B north-back partial
  wallZ(14, -32, -26, 6, 1, matDark);    // behind B
  block(-24, 22, 8, .5, 7, { mat: matTile });  // B platform
  crate(-21, 18, 1.6); crate(-19.3, 18, 1.6); crate(-20, 18, 1.6, 1.6);
  crate(-27, 25, 2.8);
  crate(-24, 16, 1.6);
  // B "car"/hut
  block(-28, 19, 3, 1.8, 2, { mat: matDark });

  // connector from tunnels to B (between x -32..-24, z -12..14 corridor)
  wallX(-24, -12, 12, 6, 1, matDust);
  root.children.pop(); col.solids.pop();
  wallX(-24, -12, 2, 6, 1, matDust);
  wallX(-24, 8, 12, 6, 1, matDust);
  // gap z 2..8 is the passage into B area
  crate(-26, 5, 1.6);

  // =================== WINDOW Nook (mid->long angle) ===================
  block(10, 2, 3, 3.2, 3, { mat: matDark }); // window tower base
  block(10, 2, 3.4, .3, 3.4, { mat: matBox });
  root.children[root.children.length - 1].position.y = 3.3;

  // misc cover barrels (cylinders)
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6b5d3f, roughness: .7, metalness: .3 });
  function barrel(x, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.5, 12), barrelMat);
    m.position.set(x, .75, z); m.castShadow = true; root.add(m);
    col.addSolid(V(x - .9, 0, z - .9), V(x + .9, 1.5, z + .9));
    col.addStand(V(x - .55, 0, z - .55), V(x + .55, 1.5, z + .55));
  }
  barrel(2, -20); barrel(2.9, -21); barrel(-8, 24); barrel(-9, 25.2);
  barrel(26, 10); barrel(27.2, 10.8); barrel(-40, 20); barrel(-41, 21);

  // decorative awning over T spawn doors
  block(34.5, 27, 8, .4, 2.4, { mat: matCrate, solid: false });
  root.children[root.children.length - 1].position.y = 4.6;

  // site markers painted (simple quads with canvas letters)
  addSiteLetter(root, 'A', 18, -18.0);
  addSiteLetter(root, 'B', -24, 22.0);

  // sky dome
  // (handled in main.js via scene.background)

  // fog color handled in main

  return { root, col };
}

function addSiteLetter(parent, ch, x, z) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,235,180,.9)'; g.lineWidth = 7;
  g.strokeRect(8, 8, 112, 112);
  g.fillStyle = 'rgba(255,235,180,.95)';
  g.font = 'bold 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: .85 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, .55, z);
  parent.add(m);
}

// =================== Nav graph ===================
// nodes: {p: Vector3, links: indices}. Bot pathfinding = Dijkstra over links.
const N = (x, z) => V(x, 0, z);
export const NAV_NODES = [
  /*0*/ N(34.5, 36),   /*T spawn*/
  /*1*/ N(30, 36),
  /*2*/ N(27, 31),     /*long doors*/
  /*3*/ N(27, 27.5),
  /*4*/ N(24, 24),     /*tetris*/
  /*5*/ N(20, 20),     /*site A entry*/
  /*6*/ N(18, -16),    /*on A platform*/
  /*7*/ N(14, -12),
  /*8*/ N(24, -14),
  /*9*/ N(27, -4),     /*pit*/
  /*10*/ N(24, 10),    /*outside mid doors (long side)*/
  /*11*/ N(6, 20),     /*mid doors*/
  /*12*/ N(2, 10),     /*catwalk south end*/
  /*13*/ N(-3.5, 0),   /*catwalk mid*/
  /*14*/ N(-3.5, -8),  /*catwalk north*/
  /*15*/ N(-8, -14),   /*upper*/
  /*16*/ N(-18, -17),  /*tunnel mouth*/
  /*17*/ N(-28, -18),  /*tunnel mid*/
  /*18*/ N(-31, -12),  /*tunnel bend*/
  /*19*/ N(-27, 5),    /*connector B*/
  /*20*/ N(-24, 12),
  /*21*/ N(-15, 30),   /*B doors*/
  /*22*/ N(-22, 20),   /*B site front*/
  /*23*/ N(-24, 22),   /*on B platform*/
  /*24*/ N(-28, 24),
  /*25*/ N(-34, -34),  /*CT spawn*/
  /*26*/ N(-30, -30),
  /*27*/ N(-24, -26),
  /*28*/ N(-20, -24),
  /*29*/ N(-12, -22),
  /*30*/ N(10, 2),     /*window nook*/
  /*31*/ N(10, 8),
  /*32*/ N(14, 14),
  /*33*/ N(34, 30),
  /*34*/ N(30, 40),
];
export const NAV_LINKS = [
  [0, 1], [1, 2], [1, 33], [33, 2], [33, 34], [34, 0],
  [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [6, 8], [8, 9],
  [4, 10], [10, 3], [10, 11], [11, 10],
  [11, 12], [12, 13], [13, 14], [14, 15],
  [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 24],
  [15, 29], [29, 28], [28, 27], [27, 26], [26, 25], [25, 26],
  [12, 31], [31, 30], [30, 32], [32, 5], [32, 11],
  [13, 15], [7, 5], [9, 8],
  [20, 24], [22, 24],
  [19, 20]
];

export function nearestNavNode(p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NAV_NODES.length; i++) {
    const dx = NAV_NODES[i].x - p.x, dz = NAV_NODES[i].z - p.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Dijkstra shortest path returning array of Vector3 (excluding start node position, including goal pos appended)
const _adj = (() => {
  const adj = NAV_NODES.map(() => []);
  NAV_LINKS.forEach(([a, b]) => {
    if (adj[a] && adj[b]) { adj[a].push(b); adj[b].push(a); }
  });
  return adj;
})();

export function findPath(fromP, toP) {
  const s = nearestNavNode(fromP), t = nearestNavNode(toP);
  if (s === t) return [toP.clone()];
  const dist = NAV_NODES.map(() => Infinity);
  const prev = NAV_NODES.map(() => -1);
  const visited = NAV_NODES.map(() => false);
  dist[s] = 0;
  for (;;) {
    let u = -1, bd = Infinity;
    for (let i = 0; i < NAV_NODES.length; i++) if (!visited[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u === -1) break;
    visited[u] = true;
    if (u === t) break;
    for (const v of _adj[u]) {
      const a = NAV_NODES[u], b = NAV_NODES[v];
      const w = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
  if (dist[t] === Infinity) {
    // fallback: direct line (bots will slide along walls)
    return [toP.clone()];
  }
  const path = [];
  let cur = t;
  while (cur !== -1 && cur !== s) { path.unshift(NAV_NODES[cur].clone()); cur = prev[cur]; }
  path.push(toP.clone());
  return path;
}
