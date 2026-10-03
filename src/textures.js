// ============ Procedural canvas textures (dust2-style palette) ============
import * as THREE from 'three';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function noiseOverlay(ctx, size, amount, alpha) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    if (alpha !== undefined) d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

function texFrom(canvas, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- sandy ground ----
export function sandFloorTex(repeat = 64) {
  const [c, x] = makeCanvas(256);
  x.fillStyle = '#b99a63'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const r = Math.random();
    x.fillStyle = r < .5 ? `rgba(139,110,66,${.06 + Math.random() * .1})`
      : r < .8 ? `rgba(214,187,133,${.05 + Math.random() * .1})`
      : `rgba(96,74,44,${.05 + Math.random() * .12})`;
    const s = 1 + Math.random() * 4;
    x.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  // faint cracks
  x.strokeStyle = 'rgba(90,70,40,.25)'; x.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    x.beginPath();
    let px = Math.random() * 256, py = Math.random() * 256;
    x.moveTo(px, py);
    for (let j = 0; j < 8; j++) { px += (Math.random() - .5) * 40; py += (Math.random() - .5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  noiseOverlay(x, 256, 26);
  return texFrom(c, repeat);
}

// ---- dust wall (stucco) ----
export function dustWallTex(repeat = 1) {
  const [c, x] = makeCanvas(256);
  x.fillStyle = '#c9b07e'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const r = Math.random();
    x.fillStyle = r < .5 ? `rgba(160,134,90,${.05 + Math.random() * .12})`
      : `rgba(230,208,165,${.04 + Math.random() * .1})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  // stains running down
  for (let i = 0; i < 10; i++) {
    const gx = Math.random() * 256;
    const g = x.createLinearGradient(gx, 0, gx, 256);
    g.addColorStop(0, 'rgba(96,76,48,0)');
    g.addColorStop(.3, `rgba(96,76,48,${.05 + Math.random() * .1})`);
    g.addColorStop(1, 'rgba(96,76,48,0)');
    x.fillStyle = g; x.fillRect(gx - 6 - Math.random() * 14, 0, 12 + Math.random() * 28, 256);
  }
  noiseOverlay(x, 256, 20);
  return texFrom(c, repeat);
}

// ---- darker accent wall ----
export function darkWallTex(repeat = 1) {
  const [c, x] = makeCanvas(256);
  x.fillStyle = '#8f7a52'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1200; i++) {
    x.fillStyle = Math.random() < .5 ? `rgba(70,58,38,${.06 + Math.random() * .1})` : `rgba(160,140,100,${.05 + Math.random() * .08})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  // brick-ish lines
  x.strokeStyle = 'rgba(60,48,30,.28)'; x.lineWidth = 1.5;
  for (let yy = 0; yy < 256; yy += 32) { x.beginPath(); x.moveTo(0, yy); x.lineTo(256, yy); x.stroke(); }
  for (let row = 0; row < 8; row++) {
    for (let xx = (row % 2) * 32; xx < 256; xx += 64) {
      x.beginPath(); x.moveTo(xx, row * 32); x.lineTo(xx, row * 32 + 32); x.stroke();
    }
  }
  noiseOverlay(x, 256, 18);
  return texFrom(c, repeat);
}

// ---- wooden crate ----
export function crateTex(repeat = 1) {
  const [c, x] = makeCanvas(256);
  x.fillStyle = '#8a6a3e'; x.fillRect(0, 0, 256, 256);
  // planks
  for (let py = 0; py < 256; py += 42) {
    x.fillStyle = `rgb(${128 + Math.random() * 24 | 0},${96 + Math.random() * 18 | 0},${54 + Math.random() * 14 | 0})`;
    x.fillRect(0, py + 2, 256, 38);
    x.strokeStyle = 'rgba(50,34,16,.55)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, py); x.lineTo(256, py); x.stroke();
    // wood grain
    x.strokeStyle = 'rgba(80,55,25,.35)'; x.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      x.beginPath();
      const gy = py + 5 + Math.random() * 30;
      x.moveTo(0, gy);
      for (let gx = 0; gx <= 256; gx += 32) x.lineTo(gx, gy + Math.sin(gx * .05 + g) * 2);
      x.stroke();
    }
  }
  // frame boards
  x.fillStyle = 'rgba(60,42,20,.9)';
  x.fillRect(0, 0, 256, 10); x.fillRect(0, 246, 256, 10);
  x.fillRect(0, 0, 10, 256); x.fillRect(246, 0, 10, 256);
  // nails
  x.fillStyle = '#3a2c18';
  for (const nx of [5, 251]) for (const ny of [5, 128, 251]) { x.beginPath(); x.arc(nx, ny, 2.4, 0, 7); x.fill(); }
  noiseOverlay(x, 256, 14);
  return texFrom(c, repeat);
}

// ---- interior floor (tiles) ----
export function tileFloorTex(repeat = 1) {
  const [c, x] = makeCanvas(256);
  x.fillStyle = '#9a8d74'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(60,54,42,.6)'; x.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
  }
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    x.fillStyle = `rgba(${140 + Math.random() * 30 | 0},${128 + Math.random() * 26 | 0},${104 + Math.random() * 22 | 0},.35)`;
    x.fillRect(tx * 64 + 3, ty * 64 + 3, 58, 58);
  }
  noiseOverlay(x, 256, 16);
  return texFrom(c, repeat);
}

// ---- sky gradient ----
export function skyTex() {
  const [c, x] = makeCanvas(512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#8fb4cc');
  g.addColorStop(.42, '#cfd8cf');
  g.addColorStop(.52, '#e8d9ae');
  g.addColorStop(.62, '#d9b98a');
  g.addColorStop(1, '#b99a6b');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  // sun glow
  const sg = x.createRadialGradient(160, 210, 8, 160, 210, 130);
  sg.addColorStop(0, 'rgba(255,250,225,.95)');
  sg.addColorStop(.25, 'rgba(255,240,200,.5)');
  sg.addColorStop(1, 'rgba(255,240,200,0)');
  x.fillStyle = sg; x.fillRect(0, 0, 512, 512);
  // clouds
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * 512, cy = 60 + Math.random() * 150, w = 30 + Math.random() * 90;
    const cg = x.createRadialGradient(cx, cy, 2, cx, cy, w);
    cg.addColorStop(0, 'rgba(255,252,245,.5)');
    cg.addColorStop(1, 'rgba(255,252,245,0)');
    x.fillStyle = cg;
    x.save(); x.translate(cx, cy); x.scale(1, .35); x.beginPath(); x.arc(0, 0, w, 0, 7); x.fill(); x.restore();
  }
  noiseOverlay(x, 512, 6);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- character texture (jersey with number & role text) ----
export function playerTex(team, num, name) {
  const [c, x] = makeCanvas(256);
  const base = team === 'CT' ? ['#4a6076', '#3a4c5e'] : ['#7a6a3a', '#5e512c'];
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, base[0]); g.addColorStop(1, base[1]);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  // tactical stripes / vest hint
  x.fillStyle = 'rgba(20,24,28,.35)';
  x.fillRect(0, 96, 256, 46);
  x.fillStyle = 'rgba(255,255,255,.06)';
  x.fillRect(0, 100, 256, 6); x.fillRect(0, 132, 256, 6);
  // shoulder pads
  x.fillStyle = 'rgba(15,18,22,.4)';
  x.fillRect(0, 40, 52, 60); x.fillRect(204, 40, 52, 60);
  // big number on chest/back
  x.fillStyle = team === 'CT' ? 'rgba(230,240,250,.85)' : 'rgba(240,225,170,.85)';
  x.font = 'bold 88px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num), 128, 70);
  x.font = 'bold 22px Arial';
  x.fillText(name.toUpperCase(), 128, 168);
  // belt
  x.fillStyle = 'rgba(25,22,18,.6)'; x.fillRect(0, 196, 256, 14);
  noiseOverlay(x, 256, 18);
  return texFrom(c, 1);
}

// ---- muzzle flash sprite ----
export function flashTex() {
  const [c, x] = makeCanvas(128);
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(.2, 'rgba(255,225,130,.95)');
  g.addColorStop(.5, 'rgba(255,150,40,.5)');
  g.addColorStop(1, 'rgba(255,120,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  // star spikes
  x.strokeStyle = 'rgba(255,240,190,.9)'; x.lineWidth = 5; x.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + .3;
    x.beginPath(); x.moveTo(64, 64);
    x.lineTo(64 + Math.cos(a) * (34 + Math.random() * 24), 64 + Math.sin(a) * (34 + Math.random() * 24));
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- smoke puff sprite ----
export function smokeTex() {
  const [c, x] = makeCanvas(128);
  for (let i = 0; i < 12; i++) {
    const cx = 40 + Math.random() * 48, cy = 40 + Math.random() * 48, r = 18 + Math.random() * 26;
    const g = x.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0, `rgba(215,215,215,${.14 + Math.random() * .12})`);
    g.addColorStop(1, 'rgba(200,200,200,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- blood splat sprite ----
export function bloodTex() {
  const [c, x] = makeCanvas(128);
  x.fillStyle = 'rgba(120,8,8,.9)';
  x.beginPath(); x.arc(64, 64, 26, 0, 7); x.fill();
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * 7, r = 26 + Math.random() * 30;
    x.beginPath();
    x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + Math.random() * 7, 0, 7);
    x.fillStyle = `rgba(${90 + Math.random() * 60 | 0},6,6,.75)`;
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { texFrom };
