import * as THREE from './vendor/three.module.js';
const D = window.STORE_DATA, ZONES = D.zones, PRODUCTS = D.products;
const $ = s => document.querySelector(s);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------- layout ----------
const COLS = 5, CW = 11, RD = 10, X0 = -22, Z0 = -16;
const BOUND = { x0: -28, x1: 28, z0: -22, z1: 17 };
const SHELF = { len: 8, dep: 1.1, h: 2.25 };
ZONES.forEach((z, i) => { z.cx = X0 + (i % COLS) * CW; z.cz = Z0 + Math.floor(i / COLS) * RD; z.idx = i; });
const zoneById = Object.fromEntries(ZONES.map(z => [z.id, z]));
const colliders = []; // {x0,x1,z0,z1}
const addBox = (cx, cz, w, d, m = 0.05) => colliders.push({ x0: cx - w / 2 - m, x1: cx + w / 2 + m, z0: cz - d / 2 - m, z1: cz + d / 2 + m });

// ---------- renderer ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe7ee); scene.fog = new THREE.Fog(0xdfe7ee, 30, 70);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// LOW POLY + BAKED: no lights, unlit materials only
function BM(o = {}) { const { roughness, metalness, ...r } = o; return new THREE.MeshBasicMaterial({ vertexColors: !r.map && !r.transparent, ...r }); }
// bake vertical AO gradient + light falloff into vertex colours (world-space y)
function bake(geo, y0 = 0, top = 1, bot = .62) { geo = geo.index ? geo.toNonIndexed() : geo; const p = geo.attributes.position, n = geo.attributes.normal, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + y0; let k = bot + (top - bot) * Math.min(1, Math.max(0, y / 2.4)); if (n) { const ny = n.getY(i), nx = n.getX(i); k *= ny > .5 ? 1.05 : ny < -.5 ? .7 : (.86 + .08 * nx); } c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = Math.min(1, k); }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; }
const _Mesh = THREE.Mesh; class BMesh extends _Mesh { constructor(g, m) { super(g, m); } }

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// floor
const floorTex = canvasTex(256, 256, (g) => { g.fillStyle = '#f2efe8'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#e4dfd3'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128); g.strokeStyle = '#cfc8b8'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke(); });
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(28, 20);
const W = BOUND.x1 - BOUND.x0, Dp = BOUND.z1 - BOUND.z0, MX = (BOUND.x0 + BOUND.x1) / 2, MZ = (BOUND.z0 + BOUND.z1) / 2;
const LM_S = 16; const floorLM = canvasTex(W * LM_S, Dp * LM_S, (g, w, h) => { g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
  const P = (x, z) => [(x - BOUND.x0) * LM_S, (z - BOUND.z0) * LM_S];
  for (let x = BOUND.x0 + 4; x < BOUND.x1 - 2; x += 5.5) for (let z = BOUND.z0 + 2.5; z < BOUND.z1; z += 5) { const [a, b] = P(x, z), gr = g.createRadialGradient(a, b, 0, a, b, 3.6 * LM_S); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(a - 60, b - 60, 120, 120); }
  g.filter = 'blur(10px)'; g.fillStyle = 'rgba(0,0,0,.45)';
  for (const z of ZONES) { const [a, b] = P(z.cx - SHELF.len / 2 - .3, z.cz - SHELF.dep / 2 - .35); g.fillRect(a, b, (SHELF.len + .6) * LM_S, (SHELF.dep + .7) * LM_S); }
  for (const x of [-19, -13, 13, 19]) { const [a, b] = P(x - .8, 10); g.fillRect(a, b, 1.6 * LM_S, 4 * LM_S); }
  g.lineWidth = 18; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeRect(0, 0, w, h); g.filter = 'none'; });
floorLM.colorSpace = THREE.NoColorSpace; floorLM.flipY = true;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshBasicMaterial({ map: floorTex, lightMap: floorLM, lightMapIntensity: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(MX, 0, MZ); scene.add(floor);
// ceiling + lights
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshBasicMaterial({ color: 0xf4f4f0 }));
ceil.rotation.x = Math.PI / 2; ceil.position.set(MX, 4.8, MZ); scene.add(ceil);
const lampGeo = new THREE.PlaneGeometry(3, 0.5), lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 200); let ln = 0; const tm = new THREE.Object3D();
for (let x = BOUND.x0 + 4; x < BOUND.x1 - 2; x += 5.5) for (let z = BOUND.z0 + 2.5; z < BOUND.z1; z += 5) { tm.position.set(x, 4.78, z); tm.rotation.set(Math.PI / 2, 0, 0); tm.updateMatrix(); lamps.setMatrixAt(ln++, tm.matrix); }
lamps.count = ln; scene.add(lamps);
// walls
const wallMat = BM({ color: 0xfaf6ee, roughness: 0.9 });
const stripe = BM({ color: 0xc62828 });
function wall(x, z, w, d) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4.8, d), wallMat); m.position.set(x, 2.4, z); scene.add(m); const s = new THREE.Mesh(new THREE.BoxGeometry(w + .02, .35, d + .02), stripe); s.position.set(x, 1.1, z); scene.add(s); }
wall(MX, BOUND.z0 - .15, W, .3); wall(BOUND.x0 - .15, MZ, .3, Dp); wall(BOUND.x1 + .15, MZ, .3, Dp);
wall(-15.5, BOUND.z1 + .15, 25, .3); wall(15.5, BOUND.z1 + .15, 25, .3); // entrance gap x -3..3
const glass = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, .1), BM({ color: 0x9fd3ff, transparent: true, opacity: .25 }));
glass.position.set(0, 1.6, BOUND.z1 + .6); scene.add(glass); colliders.push({ x0: -4, x1: 4, z0: BOUND.z1 + .3, z1: BOUND.z1 + 2 });
const above = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, .3), wallMat); above.position.set(0, 4, BOUND.z1 + .15); scene.add(above);
function signTex(text, bg, fg = '#fff', sub = '') { return canvasTex(1024, 256, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 110; g.font = `bold ${fs}px system-ui,sans-serif`; while (g.measureText(text).width > w - 80) { fs -= 4; g.font = `bold ${fs}px system-ui,sans-serif`; } g.fillText(text, w / 2, sub ? h / 2 - 22 : h / 2); if (sub) { g.font = '600 40px system-ui,sans-serif'; g.fillText(sub, w / 2, h - 48); } }); }
function sign(text, bg, x, y, z, w = 4.4, sub = '', rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTex(text, bg, '#fff', sub), side: THREE.DoubleSide }));
  m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); return m;
}
const big = sign('RAHIM STORE', '#c62828', 0, 3.4, BOUND.z0 + .05, 12, 'Since 1979 · Main Boulevard A.I.T. Lahore'); 
sign('WELCOME · ENTRANCE', '#2e7d32', 0, 3.6, BOUND.z1 - .05, 5, '', Math.PI);

// ---------- shelves / zones ----------
const shelfMat = BM({ color: 0xe9ecef, roughness: .6, metalness: .2 });
const boardMat = BM({ color: 0xffffff, roughness: .5 });
const TIERS = [0.12, 0.66, 1.2, 1.74];
const chain = new THREE.CylinderGeometry(.015, .015, 1.4, 4), chainMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
for (const z of ZONES) {
  const col = new THREE.Color(z.color);
  const g = new THREE.Group(); g.position.set(z.cx, 0, z.cz);
  const back = new THREE.Mesh(new THREE.BoxGeometry(SHELF.len, SHELF.h, .08), shelfMat); back.position.y = SHELF.h / 2; g.add(back);
  for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(.08, SHELF.h + .1, SHELF.dep), BM({ color: col })); side.position.set(sx * SHELF.len / 2, SHELF.h / 2, 0); g.add(side); }
  for (const y of TIERS) { const b = new THREE.Mesh(new THREE.BoxGeometry(SHELF.len, .04, SHELF.dep), boardMat); b.position.y = y - .02; g.add(b);
    for (const f of [-1, 1]) { const lip = new THREE.Mesh(new THREE.BoxGeometry(SHELF.len, .07, .02), BM({ color: col })); lip.position.set(0, y - .02, f * SHELF.dep / 2); g.add(lip); } }
  const top = new THREE.Mesh(new THREE.BoxGeometry(SHELF.len + .1, .12, SHELF.dep + .1), BM({ color: col })); top.position.y = SHELF.h + .06; g.add(top);
  scene.add(g); addBox(z.cx, z.cz, SHELF.len + .1, SHELF.dep + .1);
  // hanging signs (both sides readable)
  const s = sign(z.name.toUpperCase(), z.color, z.cx, 3.55, z.cz, 4.6, 'Aisle ' + (z.idx + 1));
  for (const sx of [-1.8, 1.8]) { const c = new THREE.Mesh(chain, chainMat); c.position.set(z.cx + sx, 4.1, z.cz); scene.add(c); }
  // end-cap signs
  for (const sx of [-1, 1]) { const e = sign(z.name, z.color, z.cx + sx * (SHELF.len / 2 + .05), 2.0, z.cz, 1.0, '', sx * Math.PI / 2); e.scale.set(1, 1, 1); }
  // floor colour frame
  const fm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .55 });
  const fw = CW - 1.2, fd = RD - 1.2;
  for (const [w, d, x, zz] of [[fw, .18, 0, -fd / 2], [fw, .18, 0, fd / 2], [.18, fd, -fw / 2, 0], [.18, fd, fw / 2, 0]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fm); p.rotation.x = -Math.PI / 2; p.position.set(z.cx + x, .012, z.cz + zz); scene.add(p); }
}
// checkout counters
const ctrMat = BM({ color: 0x37474f }), beltMat = BM({ color: 0x111111 }), regMat = BM({ color: 0xc62828 });
for (const x of [-19, -13, 13, 19]) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, .9, 3.4), ctrMat); c.position.set(x, .45, 12); scene.add(c);
  const b = new THREE.Mesh(new THREE.BoxGeometry(.8, .02, 2.4), beltMat); b.position.set(x, .91, 11.6); scene.add(b);
  const r = new THREE.Mesh(new THREE.BoxGeometry(.5, .4, .4), regMat); r.position.set(x, 1.1, 13.3); scene.add(r);
  addBox(x, 12, 1.1, 3.4);
}
sign('CHECKOUT', '#2e7d32', -16, 3.4, 12, 4, 'Pay here', Math.PI); sign('CHECKOUT', '#2e7d32', 16, 3.4, 12, 4, 'Pay here', Math.PI);
const CHECKOUT_ZONE = { x0: -21, x1: -11, z0: 10, z1: 15, x2: 11, x3: 21 };

// ---------- products ----------
const DIM = { box: [.36, .46, .12], bag: [.4, .48, .16], carton: [.22, .4, .15], can: [.1, .24], bottle: [.085, .46] };
const GEO = {
  box: new THREE.BoxGeometry(...DIM.box), bag: new THREE.BoxGeometry(...DIM.bag), carton: new THREE.BoxGeometry(...DIM.carton),
  can: new THREE.CylinderGeometry(DIM.can[0], DIM.can[0], DIM.can[1], 8),
  bottle: (() => { const r = DIM.bottle[0], h = DIM.bottle[1]; const pts = [[0, 0], [r * .9, 0], [r, .02], [r, h * .62], [r * .85, h * .7], [r * .38, h * .82], [r * .36, h * .94], [r * .4, h * .95], [r * .4, h], [0, h]].map(p => new THREE.Vector2(p[0], p[1])); const gg = new THREE.LatheGeometry(pts, 8); gg.translate(0, -h / 2, 0); return gg; })(),
};
// lathe uv.y follows profile index: label region (0.1..0.33 of path) -> map v via texture transform below
for (const k of ['bag']) { const p = GEO[k].attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setZ(i, p.getZ(i) * (1 - Math.abs(y) * 1.2) * (1 - Math.abs(x) * .4)); } GEO[k].computeVertexNormals(); }
const heightOf = s => s === 'can' ? DIM.can[1] : s === 'bottle' ? DIM.bottle[1] : DIM[s][1];
const productMeshes = []; const texLoader = new THREE.TextureLoader();
function avgColor(img) { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 720) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } return n ? new THREE.Color(`rgb(${r / n | 0},${gg / n | 0},${b / n | 0})`) : new THREE.Color(0xdddddd); }
function makeMaterials(p, tex) {
  const ac = avgColor(tex.image); const side = new THREE.MeshBasicMaterial({ color: ac.clone().multiplyScalar(.82) }); const topM = new THREE.MeshBasicMaterial({ color: ac.clone().lerp(new THREE.Color(1,1,1), .25) });
  const face = new THREE.MeshBasicMaterial({ map: tex });
  if (p.shape === 'can') { tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(2, 1); tex.offset.x = .5; return [face, new THREE.MeshBasicMaterial({ color: 0xbfc5ca }), new THREE.MeshBasicMaterial({ color: 0xbfc5ca })]; }
  if (p.shape === 'bottle') { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(2, 2.2); tex.offset.set(.5, -0.2); face.color = new THREE.Color(0xffffff); return face; }
  return [side, side, topM, side, face, face]; // box faces: +x,-x,+y,-y,+z(front),-z
}
const loadStatus = { done: 0, total: PRODUCTS.length };
function placeProducts(p, mats) {
  const z = zoneById[p.zone]; const list = PRODUCTS.filter(q => q.zone === p.zone); const k = list.indexOf(p);
  const COLS_PER = 3, tier = Math.floor(k / COLS_PER) % 4, colI = k % COLS_PER; const slotW = SHELF.len / COLS_PER;
  const copies = 4, hgt = heightOf(p.shape), wid = p.shape === 'can' ? .22 : p.shape === 'bottle' ? .2 : DIM[p.shape][0] + .04;
  const n = Math.min(copies, Math.floor((slotW - .2) / wid));
  const mesh = new THREE.InstancedMesh(GEO[p.shape], mats, n * 2); mesh.userData.product = p;
  let i = 0;
  for (const face of [1, -1]) for (let c = 0; c < n; c++) {
    const lx = -SHELF.len / 2 + slotW * (face === 1 ? colI : COLS_PER - 1 - colI) + slotW / 2 + (c - (n - 1) / 2) * wid;
    tm.position.set(z.cx + lx, TIERS[face === 1 ? tier : 3 - tier] + hgt / 2 + .002, z.cz + face * (SHELF.dep / 2 - .14));
    tm.rotation.set(0, face === 1 ? 0 : Math.PI, 0); tm.scale.set(1, 1, 1); tm.updateMatrix(); mesh.setMatrixAt(i++, tm.matrix);
  }
  mesh.computeBoundingSphere(); scene.add(mesh); productMeshes.push(mesh); p.mesh = mesh; p.mats = mats;
  // price tag on shelf lip
}
const priceTags = [];
function loadProducts() {
  return Promise.all(PRODUCTS.map(p => new Promise(res => texLoader.load(p.img, tex => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; placeProducts(p, makeMaterials(p, tex)); tick(); res(); }, undefined, () => { console.warn('missing', p.img); tick(); res(); }))));
  function tick() { loadStatus.done++; $('#prog').style.width = (100 * loadStatus.done / loadStatus.total) + '%'; $('#ptxt').textContent = `Stocking shelves… ${loadStatus.done}/${loadStatus.total}`; }
}

// ---------- cart (player) ----------
const cart = new THREE.Group();
{ const wire = BM({ color: 0xb0bec5, metalness: .8, roughness: .3 }); const red = BM({ color: 0xc62828 });
  const bw = .9, bl = 1.25, bh = .6, by = .55;
  const basket = new THREE.Group(); basket.position.y = by;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(bw, .03, bl), wire); basket.add(bottom);
  for (const [w, h, d, x, y, z] of [[bw, bh, .03, 0, bh / 2, bl / 2], [bw, bh, .03, 0, bh / 2, -bl / 2], [.03, bh, bl, bw / 2, bh / 2, 0], [.03, bh, bl, -bw / 2, bh / 2, 0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), BM({ color: 0xcfd8dc, metalness: .6, roughness: .4, transparent: true, opacity: .55 })); m.position.set(x, y, z); basket.add(m);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + .02, .04, d + .02), red); rim.position.set(x, bh, z); basket.add(rim); }
  cart.add(basket); cart.userData.basket = basket;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, bw + .1, 5), red); handle.rotation.z = Math.PI / 2; handle.position.set(0, by + bh + .18, -bl / 2 - .2); cart.add(handle);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(.03, .03, .3), wire); arm.position.set(sx * bw / 2, by + bh + .1, -bl / 2 - .1); arm.rotation.x = .5; cart.add(arm); }
  const skin = BM({ color: 0xc68e62 }), sleeve = BM({ color: 0x1565c0 });
  for (const sx of [-1, 1]) { const hand = new THREE.Mesh(new THREE.BoxGeometry(.07, .05, .09), skin); hand.position.set(sx * .27, by + bh + .2, -bl / 2 - .22); cart.add(hand);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.075, .075, .5), sleeve); arm.position.set(sx * .3, by + bh + .08, -bl / 2 - .45); arm.rotation.x = -.5; cart.add(arm); }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(bw * .9, .04, bl * 1.05), wire); frame.position.y = .16; cart.add(frame);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.03, by - .1, .03), wire); leg.position.set(sx * bw * .42, by / 2 + .05, sz * bl * .45); cart.add(leg);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .05, 6), BM({ color: 0x222222 })); wh.rotation.z = Math.PI / 2; wh.position.set(sx * bw * .42, .07, sz * bl * .45); cart.add(wh); }
  }
scene.add(cart);
const player = { x: 0, z: 15.8, h: Math.PI, v: 0, pitch: -.32, r: .35 }; const CF = 1.55, CR = .62, EYE = 1.55;
camera.fov = 70; camera.near = .05; camera.rotation.order = 'YXZ';

// ---------- input ----------
const keys = {}; const joy = { x: 0, y: 0 };
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; keys[e.code] = true;
  if (e.code === 'KeyM') toggle('#mapFull'); if (e.code === 'KeyC') toggle('#cartPanel'); if (e.code === 'KeyL') toggleLock(); if (e.code === 'Escape') ['#mapFull', '#cartPanel'].forEach(s => $(s).classList.add('hidden'));
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function toggle(s) { $(s).classList.toggle('hidden'); if (s === '#mapFull' && !$(s).classList.contains('hidden')) drawMap($('#big'), true); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).classList.add('hidden'));

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let hover = null, pdown = null;
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(productMeshes, false)[0];
  if (!hit) return null; const p = hit.object.userData.product; const m = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, m);
  const pos = new THREE.Vector3().setFromMatrixPosition(m); const dist = Math.hypot(pos.x - player.x, pos.z - player.z) - .6;
  return { p, pos, dist, rot: new THREE.Quaternion().setFromRotationMatrix(m), near: dist < 4.2 };
}
canvas.addEventListener('pointerdown', e => { pdown = { x: e.clientX, y: e.clientY, t: performance.now(), h: player.h, p: player.pitch, id: e.pointerId }; ensureAudio(); });
canvas.addEventListener('pointermove', e => {
  if (pdown && pdown.id === e.pointerId && (e.buttons || e.pointerType === 'touch')) { const dx = e.clientX - pdown.x, dy = e.clientY - pdown.y; if (pdown.drag || Math.hypot(dx, dy) > 6) { player.h = pdown.h - dx * .005; player.pitch = clampP(pdown.p - dy * .004); pdown.drag = true; } }
  if (locked) { player.h -= e.movementX * .0025; player.pitch = clampP(player.pitch - e.movementY * .0025); hover = pickAt(innerWidth / 2, innerHeight / 2); showTip(hover, innerWidth / 2, innerHeight / 2); return; }
  if (e.pointerType === 'mouse') { hover = pickAt(e.clientX, e.clientY); showTip(hover, e.clientX, e.clientY); }
});
canvas.addEventListener('pointerup', e => { if (locked) { const h = pickAt(innerWidth / 2, innerHeight / 2); if (h) { if (h.near) addToCart(h); else toast('Move closer to pick ' + h.p.name, '#555'); } pdown = null; return; } if (pdown && !pdown.drag && performance.now() - pdown.t < 600) { const h = pickAt(e.clientX, e.clientY); if (h) { if (h.near) addToCart(h); else toast('Move closer to pick ' + h.p.name, '#555'); } } pdown = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
const tip = $('#tip'); let locked = false; const clampP = p => Math.max(-1.1, Math.min(.6, p));
function toggleLock() { if (document.pointerLockElement) document.exitPointerLock(); else canvas.requestPointerLock?.(); }
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; document.body.classList.toggle('locked', locked); });
$('#lookBtn').onclick = () => toggleLock();
function showTip(h, x, y) { canvas.style.cursor = h ? (h.near ? 'pointer' : 'not-allowed') : 'default'; if (!h) { tip.style.display = 'none'; return; }
  tip.innerHTML = `${h.p.name}<br><b>Rs ${fmt(h.p.price)}</b>${h.near ? ' · click to add' : ' · move closer'}`; tip.style.display = 'block'; tip.style.left = Math.min(x + 16, innerWidth - 270) + 'px'; tip.style.top = (y + 16) + 'px'; }
// highlight
const hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffeb3b, wireframe: true })); hl.visible = false; scene.add(hl);
// joystick
{ const j = $('#joy'), k = $('#knob'); let id = null; const R = 45;
  const upd = e => { const r = j.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } k.style.left = 35 + dx + 'px'; k.style.top = 35 + dy + 'px'; joy.x = dx / R; joy.y = -dy / R; };
  j.addEventListener('pointerdown', e => { id = e.pointerId; j.setPointerCapture(id); upd(e); ensureAudio(); });
  j.addEventListener('pointermove', e => { if (e.pointerId === id) upd(e); });
  const end = () => { id = null; joy.x = joy.y = 0; k.style.left = k.style.top = '35px'; }; j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end); }

// ---------- audio ----------
let actx = null, rollGain = null;
function ensureAudio() { if (actx) { actx.state === 'suspended' && actx.resume(); return; } try { actx = new (window.AudioContext || window.webkitAudioContext)();
  const len = actx.sampleRate * 2, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { last = last * .97 + (Math.random() * 2 - 1) * .03; d[i] = last * 4 * (1 + .5 * Math.sin(i / 900)); }
  const src = actx.createBufferSource(); src.buffer = buf; src.loop = true; const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; rollGain = actx.createGain(); rollGain.gain.value = 0; src.connect(f).connect(rollGain).connect(actx.destination); src.start(); } catch (e) { actx = null; } }
function beep(freqs = [880, 1320], dur = .09) { if (!actx) return; let t = actx.currentTime; for (const f of freqs) { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + .02); t += dur * .9; } }
function thud() { if (!actx) return; const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + .15); g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .18); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .2); }

// ---------- cart logic ----------
const basketItems = []; const flyers = []; const cartLines = new Map();
const fmt = n => Math.round(n).toLocaleString('en-PK');
function addToCart(h) {
  const p = h.p; const line = cartLines.get(p.id) || { p, q: 0 }; line.q++; cartLines.set(p.id, line);
  const m = new THREE.Mesh(GEO[p.shape], p.mats); m.position.copy(h.pos); m.quaternion.copy(h.rot); scene.add(m);
  flyers.push({ m, from: h.pos.clone(), t: 0, p }); beep(); updateCartUI(); toast('Added: ' + p.name + ' · Rs ' + fmt(p.price));
}
function landInBasket(f) {
  scene.remove(f.m); const bk = cart.userData.basket; const n = basketItems.length; if (n >= 36) { f.m.geometry = null; return; }
  const m = new THREE.Mesh(GEO[f.p.shape], f.p.mats); m.scale.setScalar(.8);
  const col = n % 3, row = Math.floor(n / 3) % 4, lay = Math.floor(n / 12);
  m.position.set((col - 1) * .27, .2 + lay * .2, (row - 1.5) * .28); m.rotation.set(0, Math.PI + (Math.random() - .5) * .4, 0); m.position.y = .03 + heightOf(f.p.shape) * .4 + lay * .38; bk.add(m); basketItems.push({ m, id: f.p.id }); thud();
}
function rebuildBasket() { const bk = cart.userData.basket; basketItems.splice(0).forEach(b => bk.remove(b.m)); for (const l of cartLines.values()) for (let i = 0; i < l.q; i++) landInBasket({ m: new THREE.Object3D(), p: l.p }); }
function totals() { let c = 0, t = 0; for (const l of cartLines.values()) { c += l.q; t += l.q * l.p.price; } return { c, t }; }
function updateCartUI() { const { c, t } = totals(); $('#cnt').textContent = c; $('#tot').textContent = $('#tot2').textContent = fmt(t);
  const L = $('#cartList'); L.innerHTML = c ? '' : '<p style="color:#888">Cart is empty. Drive to a shelf and click products!</p>';
  for (const l of cartLines.values()) { const d = document.createElement('div'); d.className = 'ci'; d.innerHTML = `<img src="${l.p.img}" alt=""><div class="n">${l.p.name}<br><small>Rs ${fmt(l.p.price)} × ${l.q} = <b>Rs ${fmt(l.p.price * l.q)}</b></small></div><button data-a="-">−</button><button data-a="+">+</button><button class="rm" data-a="x" title="Remove">🗑</button>`;
    d.onclick = e => { const a = e.target.dataset.a; if (!a) return; if (a === '+') l.q++; if (a === '-') l.q--; if (a === 'x' || l.q <= 0) cartLines.delete(l.p.id); beep([a === '+' ? 990 : 440], .06); updateCartUI(); rebuildBasket(); }; L.appendChild(d); }
  $('#checkout').disabled = !c; }
$('#cartBtn').onclick = () => toggle('#cartPanel'); $('#mapBtn').onclick = () => toggle('#mapFull');
$('#checkout').onclick = () => { const { c, t } = totals(); if (!c) return; const now = new Date(); const inv = 'RS-' + now.getTime().toString().slice(-7);
  let rows = ''; for (const l of cartLines.values()) rows += `<tr><td>${l.p.name}<br><small>${l.q} × ${fmt(l.p.price)}</small></td><td>${fmt(l.q * l.p.price)}</td></tr>`;
  $('#paper').innerHTML = `<h3>RAHIM STORE</h3><p style="text-align:center;margin:2px 0">Main Boulevard A.I.T. Lahore<br>Virtual Store Receipt</p><p>Invoice: ${inv}<br>${now.toLocaleString()}</p><hr><table>${rows}</table><hr><table><tr><td>Items</td><td>${c}</td></tr><tr><td><b>TOTAL</b></td><td><b>Rs ${fmt(t)}</b></td></tr></table><p style="text-align:center">Thank you for shopping!<br><small>Demo only – no payment taken. Prices from rahimstore.com.</small></p><button id="newShop">Start new shopping</button>`;
  $('#receipt').classList.remove('hidden'); $('#cartPanel').classList.add('hidden'); beep([660, 880, 1100, 1320], .12);
  $('#newShop').onclick = () => { cartLines.clear(); updateCartUI(); rebuildBasket(); $('#receipt').classList.add('hidden'); teleportTo(0, 15.8, Math.PI); }; };
let toastT; function toast(s, bg = '#2e7d32') { const t = $('#toast'); t.textContent = s; t.style.background = bg; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, 1600); }

// ---------- map ----------
function drawMap(cv, full) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height, pad = full ? 20 : 8;
  const s = Math.min((w - pad * 2) / W, (h - pad * 2) / Dp), ox = (w - W * s) / 2, oz = (h - Dp * s) / 2;
  const P = (x, z) => [ox + (x - BOUND.x0) * s, oz + (z - BOUND.z0) * s]; cv._tf = { s, ox, oz };
  g.clearRect(0, 0, w, h); g.fillStyle = '#f7f3ea'; g.fillRect(...P(BOUND.x0, BOUND.z0), W * s, Dp * s); g.strokeStyle = '#555'; g.lineWidth = 2; g.strokeRect(...P(BOUND.x0, BOUND.z0), W * s, Dp * s);
  const cur = currentZone();
  for (const z of ZONES) { const [x, y] = P(z.cx - (CW - 1.2) / 2, z.cz - (RD - 1.2) / 2); g.fillStyle = z.color + (z === cur ? '88' : '40'); g.fillRect(x, y, (CW - 1.2) * s, (RD - 1.2) * s);
    const [sx, sy] = P(z.cx - SHELF.len / 2, z.cz - SHELF.dep / 2); g.fillStyle = z.color; g.fillRect(sx, sy, SHELF.len * s, SHELF.dep * s);
    g.fillStyle = '#222'; g.textAlign = 'center'; g.font = `600 ${full ? 14 : 7}px system-ui`; const [lx, ly] = P(z.cx, z.cz - (full ? 2.6 : 2.4)); g.fillText(full ? z.name : z.name.split(/ [&,]/)[0], lx, ly); }
  g.fillStyle = '#37474f'; for (const x of [-19, -13, 13, 19]) { const [a, b] = P(x - .55, 10.3); g.fillRect(a, b, 1.1 * s, 3.4 * s); }
  g.fillStyle = '#2e7d32'; g.font = `600 ${full ? 13 : 7}px system-ui`; g.fillText('CHECKOUT', ...P(-16, 15.8)); g.fillText('CHECKOUT', ...P(16, 15.8)); g.fillText('ENTRANCE', ...P(0, 16.6));
  const [px, py] = P(player.x, player.z); g.save(); g.translate(px, py); g.rotate(-player.h + Math.PI); const r = full ? 11 : 6; g.fillStyle = '#d50000'; g.beginPath(); g.moveTo(0, -r * 1.4); g.lineTo(r, r); g.lineTo(-r, r); g.closePath(); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.restore();
}
$('#big').addEventListener('click', e => { const cv = e.target, r = cv.getBoundingClientRect(), k = Math.min(r.width / cv.width, r.height / cv.height); const offx = (r.width - cv.width * k) / 2, offy = (r.height - cv.height * k) / 2;
  const mx = (e.clientX - r.left - offx) / k, my = (e.clientY - r.top - offy) / k, { s, ox, oz } = cv._tf; const x = (mx - ox) / s + BOUND.x0, z = (my - oz) / s + BOUND.z0;
  const zz = ZONES.find(q => Math.abs(q.cx - x) < CW / 2 && Math.abs(q.cz - z) < RD / 2); if (zz) { goZone(zz); $('#mapFull').classList.add('hidden'); } });
function goZone(z) { teleportTo(z.cx, z.cz + 3.3, Math.PI); toast('📍 ' + z.name, z.color); }
function teleportTo(x, z, h) { player.x = x; player.z = z; player.h = h; player.v = 0; player.pitch = -.32; collide(); }
function currentZone() { return ZONES.find(q => Math.abs(q.cx - player.x) < CW / 2 && Math.abs(q.cz - player.z) < RD / 2) || null; }
{ const c = $('#cats'); for (const z of ZONES) { const b = document.createElement('button'); b.textContent = z.name; b.style.borderColor = z.color; b.onclick = () => { goZone(z); b.blur(); }; c.appendChild(b); } }

// ---------- physics ----------
function pushCircle(cx, cz, r) { let px = 0, pz = 0;
  const bx0 = BOUND.x0 + r, bx1 = BOUND.x1 - r, bz0 = BOUND.z0 + r, bz1 = BOUND.z1 - r;
  if (cx < bx0) px += bx0 - cx; if (cx > bx1) px += bx1 - cx; if (cz < bz0) pz += bz0 - cz; if (cz > bz1) pz += bz1 - cz;
  for (const b of colliders) { const x = cx + px, z = cz + pz; const nx = Math.max(b.x0, Math.min(b.x1, x)), nz = Math.max(b.z0, Math.min(b.z1, z)); const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz);
    if (d < r) { if (d > 1e-4) { px += dx / d * (r - d); pz += dz / d * (r - d); } else { const o = [b.x0 - x - r, b.x1 - x + r, b.z0 - z - r, b.z1 - z + r]; const k = o.map(Math.abs).indexOf(Math.min(...o.map(Math.abs))); if (k < 2) px += o[k]; else pz += o[k]; } } }
  return [px, pz]; }
function collide() { let hit = false;
  for (let it = 0; it < 4; it++) { const fx = Math.sin(player.h) * CF, fz = Math.cos(player.h) * CF;
    const [ax, az] = pushCircle(player.x, player.z, player.r); const [bx, bz] = pushCircle(player.x + fx, player.z + fz, CR);
    const [ex, ez] = pushCircle(player.x + fx * .5, player.z + fz * .5, .45);
    const px = ax + bx + ex, pz = az + bz + ez; if (Math.abs(px) + Math.abs(pz) < 1e-5) break; player.x += px; player.z += pz; hit = true; }
  return hit; }
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(); let last = performance.now(), mapT = 0, zoneName = '';
function step(dt) {
  const fwdIn = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y, turnIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - joy.x;
  const maxV = (keys.ShiftLeft || keys.ShiftRight) ? 7 : 3.6; const target = Math.max(-1, Math.min(1, fwdIn)) * maxV * (fwdIn < 0 ? .6 : 1);
  player.v += (target - player.v) * Math.min(1, dt * (target === 0 ? 5 : 2.6));
  player.h += Math.max(-1, Math.min(1, turnIn)) * dt * 2.1; if (keys.KeyQ) player.h += dt * 1.8; if (keys.KeyE) player.h -= dt * 1.8;
  const ox = player.x, oz = player.z; player.x += Math.sin(player.h) * player.v * dt; player.z += Math.cos(player.h) * player.v * dt;
  if (collide()) { const moved = Math.hypot(player.x - ox, player.z - oz); player.v = Math.sign(player.v) * Math.min(Math.abs(player.v), moved / Math.max(dt, 1e-3)); }
  collide(); cart.position.set(player.x + Math.sin(player.h) * CF, 0, player.z + Math.cos(player.h) * CF); cart.rotation.y = player.h; cart.updateMatrixWorld();
  if (rollGain) rollGain.gain.setTargetAtTime(Math.min(.25, Math.abs(player.v) * .04), actx.currentTime, .05);
  // first-person camera (eye clamped inside store, below ceiling)
  const bob = Math.sin(performance.now() / 160) * Math.min(.02, Math.abs(player.v) * .006);
  camera.position.set(Math.max(BOUND.x0 + .2, Math.min(BOUND.x1 - .2, player.x)), EYE + bob, Math.max(BOUND.z0 + .2, Math.min(BOUND.z1 - .2, player.z)));
  camera.rotation.set(player.pitch, player.h + Math.PI, 0);
  // flyers
  for (let i = flyers.length - 1; i >= 0; i--) { const f = flyers[i]; f.t += dt / .55; const to = new THREE.Vector3(0, 1, 0).applyMatrix4(cart.matrixWorld);
    const t = Math.min(1, f.t); f.m.position.lerpVectors(f.from, to, t); f.m.position.y += Math.sin(t * Math.PI) * 1.2; f.m.rotation.x += dt * 8; f.m.scale.setScalar(1 - t * .2);
    if (f.t >= 1) { flyers.splice(i, 1); landInBasket(f); } }
  // hover highlight
  if (hover && hover.near) { hl.visible = true; hl.position.copy(hover.pos); const s = hover.p.shape, hh = heightOf(s); hl.scale.set(s === 'can' || s === 'bottle' ? .24 : DIM[s][0] + .05, hh + .05, .24); hl.quaternion.copy(hover.rot); } else hl.visible = false;
  const z = currentZone(); const nm = z ? z.name : (player.z > 9 ? 'Checkout & Entrance' : 'Main Aisle'); if (nm !== zoneName) { zoneName = nm; $('#zoneTag').textContent = nm; $('#zoneTag').style.background = z ? z.color : '#000a'; }
  mapT -= dt; if (mapT <= 0) { mapT = .1; drawMap($('#mini'), false); if (!$('#mapFull').classList.contains('hidden')) drawMap($('#big'), true); }
}
let running = false;
function loop() { const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; if (running) step(dt); renderer.render(scene, camera); requestAnimationFrame(loop); }

// bake AO into every untextured vertex-coloured mesh using its world height
scene.updateMatrixWorld(true);
function bakeAll(root, skip) { root.traverse(o => { if (!o.isMesh || o.isInstancedMesh || skip.has(o)) return; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m.vertexColors) return; const wp = new THREE.Vector3(); o.getWorldPosition(wp); o.geometry = bake(o.geometry.clone(), wp.y); }); }
bakeAll(scene, new Set([floor, ceil]));
// ---------- boot ----------
camera.position.set(0, EYE, 15.8); camera.rotation.set(-.32, 0, 0); cart.position.set(0, 0, 14.5); cart.rotation.y = Math.PI;
loadProducts().then(() => { $('#ptxt').textContent = `Ready – ${PRODUCTS.length} products in ${ZONES.length} sections`; const b = $('#go'); b.disabled = false; b.focus(); });
$('#go').onclick = () => { ensureAudio(); $('#start').classList.add('hidden'); $('#hud').classList.remove('hidden'); running = true; updateCartUI(); };
requestAnimationFrame(loop);
window.__game = { player, cartLines, PRODUCTS, ZONES, pickAt, addToCart, goZone, teleportTo, totals, camera, keys, colliders, loaded: () => loadStatus.done === loadStatus.total };
