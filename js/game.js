import * as THREE from './vendor/three.module.js';
import { startMultiplayer } from './mp.js';
const D = window.STORE_DATA, DEPTS = D.depts, CATS = D.cats;
const $ = s => document.querySelector(s);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const SHAPES = { x: 'box', g: 'bag', k: 'carton', c: 'can', b: 'bottle' };
const PRODUCTS = D.P.map((a, i) => ({ i, id: a[0], name: a[1], price: a[2], cat: a[3], shape: SHAPES[a[4]] || 'box', col: '#' + (a[5] || 'cccccc'), img: 'assets/t/' + a[0] + '.webp' }));
const byId = new Map(PRODUCTS.map(p => [p.id, p]));

// ---------- layout: departments -> units (double-sided shelves, 144 slots each) ----------
const SHELF = { len: 8, dep: 1.1, h: 2.25 }, TIERS = [0.12, 0.66, 1.2, 1.74], SLOTW = SHELF.len / 18;
const NC = 8, XP = 10.5, ZP = 6;
const units = []; // {k,cx,cz,dept,cats:Set,subs:Set}
{ let u = null, slot = 144, lastDept = -1;
  const newUnit = d => { u = { k: units.length, dept: d, cats: [], subs: [] }; units.push(u); slot = 0; };
  for (const [ci, c] of CATS.entries()) {
    c.products = PRODUCTS.filter(p => p.cat === ci); if (!c.products.length) continue;
    if (c.dept !== lastDept) { newUnit(c.dept); lastDept = c.dept; }
    slot = Math.ceil(slot / 4) * 4; if (slot >= 144) newUnit(c.dept);
    c.start = { unit: u.k, slot };
    for (const p of c.products) { if (slot >= 144) newUnit(c.dept); p.unit = u.k; p.slot = slot++; if (!u.cats.includes(ci)) u.cats.push(ci); if (!u.subs.includes(c.sub)) u.subs.push(c.sub); }
  } }
const NR = Math.ceil(units.length / NC);
const X0 = -(NC - 1) * XP / 2, Z0 = -(NR - 1) * ZP / 2 - 4;
units.forEach(u => { u.cx = X0 + (u.k % NC) * XP; u.cz = Z0 + Math.floor(u.k / NC) * ZP; });
const FRONT = Z0 + (NR - 1) * ZP + 3.5; // checkout strip starts here
const BOUND = { x0: X0 - XP / 2 - 2, x1: X0 + (NC - 1) * XP + XP / 2 + 2, z0: Z0 - 5, z1: FRONT + 9 };
const W = BOUND.x1 - BOUND.x0, Dp = BOUND.z1 - BOUND.z0, MX = (BOUND.x0 + BOUND.x1) / 2, MZ = (BOUND.z0 + BOUND.z1) / 2;
function slotPos(p) { const u = units[p.unit]; const face = p.slot < 72 ? 1 : -1, r = p.slot % 72, col = Math.floor(r / 4), tier = 3 - (r % 4);
  const lx = -SHELF.len / 2 + (col + .5) * SLOTW; return { x: u.cx + lx * face, y: TIERS[tier], z: u.cz + face * (SHELF.dep / 2 - .14), face }; }
PRODUCTS.forEach(p => { if (p.unit !== undefined) Object.assign(p, { pos: slotPos(p) }); });
const colliders = []; const addBox = (cx, cz, w, d, m = 0.05) => colliders.push({ x0: cx - w / 2 - m, x1: cx + w / 2 + m, z0: cz - d / 2 - m, z1: cz + d / 2 + m });

// ---------- renderer (unlit, baked) ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.25 : 1.75)); renderer.shadowMap.enabled = false; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe7ee); scene.fog = new THREE.Fog(0xdfe7ee, 28, 60);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 90); camera.rotation.order = 'YXZ';
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
function BM(o = {}) { return new THREE.MeshBasicMaterial({ vertexColors: !o.map && !o.transparent, ...o }); }
function bake(geo, y0 = 0, top = 1, bot = .62) { geo = geo.index ? geo.toNonIndexed() : geo; const p = geo.attributes.position, n = geo.attributes.normal, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + y0; let k = bot + (top - bot) * Math.min(1, Math.max(0, y / 2.4)); if (n) { const ny = n.getY(i), nx = n.getX(i); k *= ny > .5 ? 1.05 : ny < -.5 ? .7 : (.86 + .08 * nx); } c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = Math.min(1, k); }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; }
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const tm = new THREE.Object3D();
// floor with baked lightmap
const floorTex = canvasTex(256, 256, g => { g.fillStyle = '#f2efe8'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#e4dfd3'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128); g.strokeStyle = '#cfc8b8'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256); });
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(W / 2, Dp / 2);
const LM_S = 8, LP = (x, z) => [(x - BOUND.x0) * LM_S, (z - BOUND.z0) * LM_S];
const lampPts = []; for (let x = BOUND.x0 + 4; x < BOUND.x1 - 2; x += 5.5) for (let z = BOUND.z0 + 2.5; z < BOUND.z1; z += 6) lampPts.push([x, z]);
const floorLM = canvasTex(Math.ceil(W * LM_S), Math.ceil(Dp * LM_S), (g, w, h) => { g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
  for (const [x, z] of lampPts) { const [a, b] = LP(x, z), gr = g.createRadialGradient(a, b, 0, a, b, 3.6 * LM_S); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(a - 40, b - 40, 80, 80); }
  g.filter = 'blur(6px)'; g.fillStyle = 'rgba(0,0,0,.45)';
  for (const u of units) { const [a, b] = LP(u.cx - SHELF.len / 2 - .3, u.cz - SHELF.dep / 2 - .35); g.fillRect(a, b, (SHELF.len + .6) * LM_S, (SHELF.dep + .7) * LM_S); }
  g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeRect(0, 0, w, h); g.filter = 'none'; });
floorLM.colorSpace = THREE.NoColorSpace;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshBasicMaterial({ map: floorTex, lightMap: floorLM }));
floor.rotation.x = -Math.PI / 2; floor.position.set(MX, 0, MZ); scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshBasicMaterial({ color: 0xf4f4f0 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(MX, 4.8, MZ); scene.add(ceil);
const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, .5), new THREE.MeshBasicMaterial({ color: 0xffffff }), lampPts.length);
lampPts.forEach(([x, z], i) => { tm.position.set(x, 4.78, z); tm.rotation.set(Math.PI / 2, 0, 0); tm.updateMatrix(); lamps.setMatrixAt(i, tm.matrix); }); scene.add(lamps);
const wallMat = BM({ color: 0xfaf6ee }), stripe = BM({ color: 0xc62828 });
function wall(x, z, w, d) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4.8, d), wallMat); m.position.set(x, 2.4, z); scene.add(m); const s = new THREE.Mesh(new THREE.BoxGeometry(w + .02, .35, d + .02), stripe); s.position.set(x, 1.1, z); scene.add(s); }
wall(MX, BOUND.z0 - .15, W, .3); wall(BOUND.x0 - .15, MZ, .3, Dp); wall(BOUND.x1 + .15, MZ, .3, Dp);
const halfW = (W - 6) / 2; wall(BOUND.x0 + halfW / 2, BOUND.z1 + .15, halfW, .3); wall(BOUND.x1 - halfW / 2, BOUND.z1 + .15, halfW, .3);
const glass = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, .1), BM({ color: 0x9fd3ff, transparent: true, opacity: .25 })); glass.position.set(MX, 1.6, BOUND.z1 + .6); scene.add(glass);
const above = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, .3), wallMat); above.position.set(MX, 4, BOUND.z1 + .15); scene.add(above);
function fitText(g, text, maxW, fs, weight = 'bold') { g.font = `${weight} ${fs}px system-ui,sans-serif`; while (g.measureText(text).width > maxW && fs > 10) { fs -= 2; g.font = `${weight} ${fs}px system-ui,sans-serif`; } return fs; }
function signTex(text, bg, sub = '') { return canvasTex(1024, 256, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, text, w - 80, 104); g.fillText(text, w / 2, sub ? h / 2 - 26 : h / 2); if (sub) { fitText(g, sub, w - 80, 40, '600'); g.fillText(sub, w / 2, h - 46); } }); }
function sign(text, bg, x, y, z, w = 4.4, sub = '', rotY = 0) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTex(text, bg, sub), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); return m; }
sign('RAHIM STORE', '#c62828', MX, 3.4, BOUND.z0 + .05, 12, `Since 1979 · ${PRODUCTS.length.toLocaleString()} products · ${DEPTS.length} departments`);
sign('WELCOME · ENTRANCE', '#2e7d32', MX, 3.6, BOUND.z1 - .05, 5, '', Math.PI);

// ---------- shelves, signs, category tags ----------
const shelfMat = BM({ color: 0xe9ecef }), boardMat = BM({ color: 0xffffff });
const deptMats = DEPTS.map(d => BM({ color: new THREE.Color(d.color) }));
const chainGeo = new THREE.CylinderGeometry(.015, .015, 1.4, 4), chainMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
for (const u of units) {
  const d = DEPTS[u.dept], dm = deptMats[u.dept]; const g = new THREE.Group(); g.position.set(u.cx, 0, u.cz);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); };
  add(new THREE.BoxGeometry(SHELF.len, SHELF.h, .08), shelfMat, 0, SHELF.h / 2, 0);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(.08, SHELF.h + .1, SHELF.dep), dm, sx * SHELF.len / 2, SHELF.h / 2, 0);
  for (const y of TIERS) { add(new THREE.BoxGeometry(SHELF.len, .04, SHELF.dep), boardMat, 0, y - .02, 0); for (const f of [-1, 1]) add(new THREE.BoxGeometry(SHELF.len, .07, .02), dm, 0, y - .02, f * SHELF.dep / 2); }
  add(new THREE.BoxGeometry(SHELF.len + .1, .3, SHELF.dep + .1), dm, 0, SHELF.h + .15, 0);
  scene.add(g); addBox(u.cx, u.cz, SHELF.len + .1, SHELF.dep + .1);
  sign(d.name.toUpperCase(), d.color, u.cx, 3.55, u.cz, 4.8, `Aisle ${u.k + 1} · ${u.subs.join(' · ')}`);
  for (const sx of [-1.8, 1.8]) { const c = new THREE.Mesh(chainGeo, chainMat); c.position.set(u.cx + sx, 4.15, u.cz); scene.add(c); }
  // end caps: list of categories on this unit
  const endTex = canvasTex(256, 384, (gg, w, h) => { gg.fillStyle = d.color; gg.fillRect(0, 0, w, h); gg.fillStyle = '#fff'; gg.textAlign = 'center'; fitText(gg, 'Aisle ' + (u.k + 1), w - 20, 40); gg.fillText('Aisle ' + (u.k + 1), w / 2, 44);
    gg.fillRect(20, 60, w - 40, 3); gg.textAlign = 'left'; const n = u.cats.length, fs = Math.min(30, Math.floor(300 / Math.max(1, n)) - 4); u.cats.forEach((ci, j) => { fitText(gg, CATS[ci].name, w - 30, fs, '600'); gg.fillText('• ' + CATS[ci].name, 14, 92 + j * (fs + 4)); }); });
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(.9, 1.35), new THREE.MeshBasicMaterial({ map: endTex })); e.position.set(u.cx + sx * (SHELF.len / 2 + .05), 1.35, u.cz); e.rotation.y = sx * Math.PI / 2; scene.add(e); }
}
// per-category tags on the top fascia above the first column of each category (both faces carry their own)
for (const [ci, c] of CATS.entries()) { if (!c.products?.length) continue;
  const runs = new Map(); for (const p of c.products) { const key = p.unit + ':' + (p.pos.face); const r = runs.get(key); if (!r) runs.set(key, { p, min: p.slot, max: p.slot }); else { r.min = Math.min(r.min, p.slot); r.max = Math.max(r.max, p.slot); } }
  const tex = canvasTex(512, 64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = DEPTS[c.dept].color; g.fillRect(0, 0, 14, h); g.fillStyle = '#222'; g.textBaseline = 'middle'; fitText(g, c.name, w - 40, 40); g.fillText(c.name, 26, h / 2 + 2); });
  for (const r of runs.values()) { const u = units[r.p.unit], face = r.p.pos.face; const c0 = Math.floor((r.min % 72) / 4), c1 = Math.floor((r.max % 72) / 4); const wcols = Math.min(4, c1 - c0 + 1) * SLOTW;
    const lx0 = -SHELF.len / 2 + c0 * SLOTW; const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(wcols, 1.1) - .04, .24), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(u.cx + (lx0 + Math.max(wcols, 1.1) / 2) * face, SHELF.h + .15, u.cz + face * (SHELF.dep / 2 + .1)); m.rotation.y = face === 1 ? 0 : Math.PI; scene.add(m); } }
// checkout counters
const ctrMat = BM({ color: 0x37474f }), beltMat = BM({ color: 0x111111 }), regMat = BM({ color: 0xc62828 });
const CK = []; for (let i = 0; i < 3; i++) { CK.push(BOUND.x0 + 6 + i * 6, BOUND.x1 - 6 - i * 6); }
for (const x of CK) { const z = FRONT + 3.2; const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, .9, 3.4), ctrMat); c.position.set(x, .45, z); scene.add(c);
  const b = new THREE.Mesh(new THREE.BoxGeometry(.8, .02, 2.4), beltMat); b.position.set(x, .91, z - .4); scene.add(b); const r = new THREE.Mesh(new THREE.BoxGeometry(.5, .4, .4), regMat); r.position.set(x, 1.1, z + 1.3); scene.add(r); addBox(x, z, 1.1, 3.4); }
sign('CHECKOUT', '#2e7d32', BOUND.x0 + 12, 3.4, FRONT + 3.2, 4, 'Pay here', Math.PI); sign('CHECKOUT', '#2e7d32', BOUND.x1 - 12, 3.4, FRONT + 3.2, 4, 'Pay here', Math.PI);

// ---------- products: one instanced mesh per (atlas page, shape); atlas pages lazy-loaded by proximity ----------
const DIM = { box: [.36, .46, .12], bag: [.4, .48, .16], carton: [.22, .4, .15], can: [.1, .24], bottle: [.085, .46] };
const GEO = { box: new THREE.BoxGeometry(...DIM.box), bag: new THREE.BoxGeometry(...DIM.bag), carton: new THREE.BoxGeometry(...DIM.carton), can: new THREE.CylinderGeometry(DIM.can[0], DIM.can[0], DIM.can[1], 8),
  bottle: (() => { const r = DIM.bottle[0], h = DIM.bottle[1]; const pts = [[0, 0], [r * .9, 0], [r, .02], [r, h * .62], [r * .85, h * .7], [r * .38, h * .82], [r * .36, h * .94], [r * .4, h * .95], [r * .4, h], [0, h]].map(p => new THREE.Vector2(p[0], p[1])); const gg = new THREE.LatheGeometry(pts, 8); gg.translate(0, -h / 2, 0); return gg; })() };
{ const p = GEO.bag.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setZ(i, p.getZ(i) * (1 - Math.abs(y) * 1.2) * (1 - Math.abs(x) * .4)); } GEO.bag.computeVertexNormals(); }
for (const g of Object.values(GEO)) g.setAttribute('aUv', g.attributes.uv);
const heightOf = s => s === 'can' ? DIM.can[1] : s === 'bottle' ? DIM.bottle[1] : DIM[s][1];
function atlasMat(kind, shape, tex) { // kind: face | side | top
  const m = new THREE.MeshBasicMaterial(tex && kind === 'face' ? { map: tex } : {});
  m.defines = { K_FACE: kind === 'face' ? 1 : 0, K_TOP: kind === 'top' ? 1 : 0, S_CYL: shape === 'can' ? 1 : 0, S_BOT: shape === 'bottle' ? 1 : 0 };
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec3 aCol; attribute vec2 aTile; attribute vec2 aUv; varying vec3 vCol2; varying vec2 vTile; varying vec2 vUv0;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCol2 = aCol; vTile = aTile; vUv0 = aUv;');
    sh.fragmentShader = 'varying vec3 vCol2; varying vec2 vTile; varying vec2 vUv0;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      #if K_FACE == 1 && defined(USE_MAP)
        vec2 u = vUv0;
        #if S_CYL == 1
          u.x = fract(u.x * 2.0 + 0.5);
        #endif
        #if S_BOT == 1
          u.x = fract(u.x * 2.0 + 0.5); u.y = clamp(u.y * 2.2 - 0.2, 0.0, 1.0);
        #endif
        u = clamp(u, 0.01, 0.99);
        vec2 auv = vec2((vTile.x + u.x) / 16.0, (15.0 - vTile.y + u.y) / 16.0);
        diffuseColor *= texture2D(map, auv);
      #else
        diffuseColor.rgb *= vCol2 * ${'(K_TOP == 1 ? 1.12 : (K_FACE == 1 ? 1.0 : 0.82))'};
      #endif`); };
  m.customProgramCacheKey = () => JSON.stringify(m.defines) + (m.map ? 'm' : ''); return m; }
function matsFor(shape, tex) { const f = atlasMat('face', shape, tex), s = atlasMat('side', shape), t = atlasMat('top', shape);
  if (shape === 'can') return [f, t, t]; if (shape === 'bottle') return tex ? f : s; return [s, s, t, s, f, f]; }
const pages = []; const productMeshes = [];
{ const groups = new Map();
  for (const p of PRODUCTS) { if (p.unit === undefined) continue; const pg = Math.floor(p.i / 256), key = pg + ':' + p.shape; if (!groups.has(key)) groups.set(key, { pg, shape: p.shape, list: [] }); groups.get(key).list.push(p);
    const P = pages[pg] || (pages[pg] = { pg, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, meshes: [], state: 0 }); P.x0 = Math.min(P.x0, p.pos.x); P.x1 = Math.max(P.x1, p.pos.x); P.z0 = Math.min(P.z0, p.pos.z); P.z1 = Math.max(P.z1, p.pos.z); }
  const col = new THREE.Color();
  for (const g of groups.values()) { const geo = GEO[g.shape].clone(); const n = g.list.length; const aCol = new Float32Array(n * 3), aTile = new Float32Array(n * 2);
    const mesh = new THREE.InstancedMesh(geo, matsFor(g.shape, null), n); mesh.userData.pidx = [];
    g.list.forEach((p, j) => { const pp = p.pos, hgt = heightOf(p.shape); tm.position.set(pp.x, pp.y + hgt / 2 + .002, pp.z); tm.rotation.set(0, pp.face === 1 ? 0 : Math.PI, 0); tm.updateMatrix(); mesh.setMatrixAt(j, tm.matrix);
      col.set(p.col); aCol.set([col.r, col.g, col.b], j * 3); const t = p.i % 256; aTile.set([t % 16, Math.floor(t / 16)], j * 2); mesh.userData.pidx.push(p.i); });
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3)); geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(aTile, 2));
    mesh.computeBoundingSphere(); mesh.userData.shape = g.shape; scene.add(mesh); productMeshes.push(mesh); pages[g.pg].meshes.push(mesh); } }
const texLoader = new THREE.TextureLoader(); let loadingPages = 0; const LOAD_R = isTouch ? 16 : 24, UNLOAD_R = LOAD_R + 12;
function pageDist(P) { const dx = Math.max(P.x0 - player.x, 0, player.x - P.x1), dz = Math.max(P.z0 - player.z, 0, player.z - P.z1); return Math.hypot(dx, dz); }
function managePages(force) { for (const P of pages) { if (!P) continue; const d = pageDist(P);
  if (P.state === 0 && d < LOAD_R && (loadingPages < 2 || force)) { P.state = 1; loadingPages++; P.promise = new Promise(res => texLoader.load(`assets/atlas/p${P.pg}.webp`, tex => { loadingPages--; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; P.tex = tex; P.state = 2; for (const m of P.meshes) m.material = matsFor(m.userData.shape, tex); res(); }, undefined, () => { loadingPages--; P.state = 0; res(); })); }
  else if (P.state === 2 && d > UNLOAD_R) { for (const m of P.meshes) m.material = matsFor(m.userData.shape, null); P.tex.dispose(); P.tex = null; P.state = 0; } } }
const thumbCache = new Map();
function thumbMats(p) { if (thumbCache.has(p.id)) return thumbCache.get(p.id); const side = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.col).multiplyScalar(.85) }); const face = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.col) });
  texLoader.load(p.img, t => { t.colorSpace = THREE.SRGBColorSpace; if (p.shape === 'can' || p.shape === 'bottle') { t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, p.shape === 'bottle' ? 2.2 : 1); t.offset.set(.5, p.shape === 'bottle' ? -.2 : 0); } face.map = t; face.color.set(0xffffff); face.needsUpdate = true; });
  const m = p.shape === 'can' ? [face, side, side] : p.shape === 'bottle' ? face : [side, side, side, side, face, face]; thumbCache.set(p.id, m); return m; }

// ---------- cart held in first person ----------
function buildCart(colHandle = 0xc62828, withArms = true) { const cart = new THREE.Group(); const wire = BM({ color: 0xb0bec5 }), red = BM({ color: colHandle });
  const bw = .9, bl = 1.25, bh = .6, by = .55; const basket = new THREE.Group(); basket.position.y = by; basket.add(new THREE.Mesh(new THREE.BoxGeometry(bw, .03, bl), wire));
  for (const [w, h, d, x, y, z] of [[bw, bh, .03, 0, bh / 2, bl / 2], [bw, bh, .03, 0, bh / 2, -bl / 2], [.03, bh, bl, bw / 2, bh / 2, 0], [.03, bh, bl, -bw / 2, bh / 2, 0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), BM({ color: 0xcfd8dc, transparent: true, opacity: .45 })); m.position.set(x, y, z); basket.add(m); const rim = new THREE.Mesh(new THREE.BoxGeometry(w + .02, .04, d + .02), red); rim.position.set(x, bh, z); basket.add(rim); }
  cart.add(basket); cart.userData.basket = basket;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, bw + .1, 5), red); handle.rotation.z = Math.PI / 2; handle.position.set(0, by + bh + .18, -bl / 2 - .2); cart.add(handle);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(.03, .03, .3), wire); arm.position.set(sx * bw / 2, by + bh + .1, -bl / 2 - .1); arm.rotation.x = .5; cart.add(arm); }
  if (withArms) { const skin = BM({ color: 0xc68e62 }), sleeve = BM({ color: 0x1565c0 }); for (const sx of [-1, 1]) { const hand = new THREE.Mesh(new THREE.BoxGeometry(.07, .05, .09), skin); hand.position.set(sx * .27, by + bh + .2, -bl / 2 - .22); cart.add(hand); const arm = new THREE.Mesh(new THREE.BoxGeometry(.075, .075, .5), sleeve); arm.position.set(sx * .3, by + bh + .08, -bl / 2 - .45); arm.rotation.x = -.5; cart.add(arm); } }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(bw * .9, .04, bl * 1.05), wire); frame.position.y = .16; cart.add(frame);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.03, by - .1, .03), wire); leg.position.set(sx * bw * .42, by / 2 + .05, sz * bl * .45); cart.add(leg); const wh = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .05, 6), BM({ color: 0x222222 })); wh.rotation.z = Math.PI / 2; wh.position.set(sx * bw * .42, .07, sz * bl * .45); cart.add(wh); }
  cart.traverse(o => { if (o.isMesh && o.material.vertexColors) { o.updateMatrixWorld(); o.geometry = bake(o.geometry.clone(), o.position.y + (o.parent === basket ? by : 0)); } }); return cart; }
const cart = buildCart(); scene.add(cart);
const player = { x: MX, z: BOUND.z1 - 1.2, h: Math.PI, v: 0, pitch: -.32, r: .35 }; const CF = 1.55, CR = .62, EYE = 1.55;

// ---------- input ----------
const keys = {}; const joy = { x: 0, y: 0 };
const typing = e => /INPUT|TEXTAREA/.test(e.target.tagName);
addEventListener('keydown', e => { if (typing(e)) return; keys[e.code] = true;
  if (e.code === 'KeyM') toggle('#mapFull'); if (e.code === 'KeyC') toggle('#cartPanel'); if (e.code === 'KeyL') toggleLock(); if (e.code === 'KeyF') { e.preventDefault(); openSearch(); }
  if (e.code === 'Escape') ['#mapFull', '#cartPanel', '#searchPanel'].forEach(s => $(s).classList.add('hidden'));
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => keys[e.code] = false); addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function toggle(s) { $(s).classList.toggle('hidden'); if (s === '#mapFull' && !$(s).classList.contains('hidden')) drawMap($('#big'), true); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).classList.add('hidden'));
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let hover = null, pdown = null, locked = false; ray.far = 12;
const clampP = p => Math.max(-1.1, Math.min(.6, p));
function pickAt(cx, cy) { const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
  const near = productMeshes.filter(m => { const s = m.boundingSphere; return s && Math.hypot(s.center.x - player.x, s.center.z - player.z) - s.radius < 12; });
  const hit = ray.intersectObjects(near, false)[0]; if (!hit) return null; const p = PRODUCTS[hit.object.userData.pidx[hit.instanceId]]; const m = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, m);
  const pos = new THREE.Vector3().setFromMatrixPosition(m); const dist = Math.hypot(pos.x - player.x, pos.z - player.z) - .6; return { p, pos, dist, rot: new THREE.Quaternion().setFromRotationMatrix(m), near: dist < 4.2 }; }
function tryPick(x, y) { const h = pickAt(x, y); if (h) { if (h.near) addToCart(h); else toast('Move closer to pick ' + h.p.name, '#555'); } }
canvas.addEventListener('pointerdown', e => { pdown = { x: e.clientX, y: e.clientY, t: performance.now(), h: player.h, p: player.pitch, id: e.pointerId }; ensureAudio(); });
canvas.addEventListener('pointermove', e => {
  if (locked) { player.h -= e.movementX * .0025; player.pitch = clampP(player.pitch - e.movementY * .0025); hover = pickAt(innerWidth / 2, innerHeight / 2); showTip(hover, innerWidth / 2, innerHeight / 2); return; }
  if (pdown && pdown.id === e.pointerId && (e.buttons || e.pointerType === 'touch')) { const dx = e.clientX - pdown.x, dy = e.clientY - pdown.y; if (pdown.drag || Math.hypot(dx, dy) > 6) { player.h = pdown.h - dx * .005; player.pitch = clampP(pdown.p - dy * .004); pdown.drag = true; } }
  if (e.pointerType === 'mouse') { hover = pickAt(e.clientX, e.clientY); showTip(hover, e.clientX, e.clientY); } });
canvas.addEventListener('pointerup', e => { if (locked) tryPick(innerWidth / 2, innerHeight / 2); else if (pdown && !pdown.drag && performance.now() - pdown.t < 600) tryPick(e.clientX, e.clientY); pdown = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function toggleLock() { if (document.pointerLockElement) document.exitPointerLock(); else canvas.requestPointerLock?.(); }
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; document.body.classList.toggle('locked', locked); });
$('#lookBtn').onclick = () => toggleLock();
const tip = $('#tip'); const fmt = n => Math.round(n).toLocaleString('en-PK');
function showTip(h, x, y) { canvas.style.cursor = h ? (h.near ? 'pointer' : 'not-allowed') : 'default'; if (!h) { tip.style.display = 'none'; return; }
  tip.innerHTML = `${esc(h.p.name)}<br><b>Rs ${fmt(h.p.price)}</b> · <small>${esc(CATS[h.p.cat].name)}</small>${h.near ? ' · click to add' : ' · move closer'}`; tip.style.display = 'block'; tip.style.left = Math.min(x + 16, innerWidth - 270) + 'px'; tip.style.top = (y + 16) + 'px'; }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffeb3b, wireframe: true })); hl.visible = false; scene.add(hl);
{ const j = $('#joy'), k = $('#knob'); let id = null; const R = 45;
  const upd = e => { const r = j.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } k.style.left = 35 + dx + 'px'; k.style.top = 35 + dy + 'px'; joy.x = dx / R; joy.y = -dy / R; };
  j.addEventListener('pointerdown', e => { id = e.pointerId; j.setPointerCapture(id); upd(e); ensureAudio(); }); j.addEventListener('pointermove', e => { if (e.pointerId === id) upd(e); });
  const end = () => { id = null; joy.x = joy.y = 0; k.style.left = k.style.top = '35px'; }; j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end); }

// ---------- audio ----------
let actx = null, rollGain = null;
function ensureAudio() { if (actx) { actx.state === 'suspended' && actx.resume(); return; } try { actx = new (window.AudioContext || window.webkitAudioContext)();
  const len = actx.sampleRate * 2, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { last = last * .97 + (Math.random() * 2 - 1) * .03; d[i] = last * 4 * (1 + .5 * Math.sin(i / 900)); }
  const src = actx.createBufferSource(); src.buffer = buf; src.loop = true; const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; rollGain = actx.createGain(); rollGain.gain.value = 0; src.connect(f).connect(rollGain).connect(actx.destination); src.start(); } catch (e) { actx = null; } }
function beep(freqs = [880, 1320], dur = .09, vol = .12) { if (!actx) return; let t = actx.currentTime; for (const f of freqs) { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + .02); t += dur * .9; } }
function thud() { if (!actx) return; const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + .15); g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .18); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .2); }

// ---------- cart logic ----------
const flyers = []; const cartLines = new Map(); let mp = null;
function addToCart(h) { const p = h.p; const line = cartLines.get(p.id) || { p, q: 0 }; line.q++; cartLines.set(p.id, line);
  const m = new THREE.Mesh(GEO[p.shape], thumbMats(p)); m.position.copy(h.pos); m.quaternion.copy(h.rot); scene.add(m);
  flyers.push({ m, from: h.pos.clone(), t: 0, p, cart }); beep(); updateCartUI(); toast('Added: ' + p.name + ' · Rs ' + fmt(p.price)); mp?.sendAdd(p.id); }
function putInBasket(c, p) { const bk = c.userData.basket; const items = c.userData.items || (c.userData.items = []); if (items.length >= 36) return; const n = items.length;
  const m = new THREE.Mesh(GEO[p.shape], thumbMats(p)); m.scale.setScalar(.8); const col = n % 3, row = Math.floor(n / 3) % 4, lay = Math.floor(n / 12);
  m.position.set((col - 1) * .27, .03 + heightOf(p.shape) * .4 + lay * .38, (row - 1.5) * .28); m.rotation.set(0, Math.PI + (Math.random() - .5) * .4, 0); bk.add(m); items.push(m); }
function clearBasket(c) { (c.userData.items || []).forEach(m => c.userData.basket.remove(m)); c.userData.items = []; }
function rebuildBasket() { clearBasket(cart); for (const l of cartLines.values()) for (let i = 0; i < l.q; i++) putInBasket(cart, l.p); }
function cartIds() { const a = []; for (const l of cartLines.values()) for (let i = 0; i < l.q; i++) a.push(l.p.id); return a; }
function totals() { let c = 0, t = 0; for (const l of cartLines.values()) { c += l.q; t += l.q * l.p.price; } return { c, t }; }
function updateCartUI() { const { c, t } = totals(); $('#cnt').textContent = c; $('#tot').textContent = $('#tot2').textContent = fmt(t);
  const L = $('#cartList'); L.innerHTML = c ? '' : '<p style="color:#888">Cart is empty. Drive to a shelf and click products!</p>';
  for (const l of cartLines.values()) { const d = document.createElement('div'); d.className = 'ci'; d.innerHTML = `<img src="${l.p.img}" alt="" loading="lazy"><div class="n">${esc(l.p.name)}<br><small>Rs ${fmt(l.p.price)} × ${l.q} = <b>Rs ${fmt(l.p.price * l.q)}</b></small></div><button data-a="-">−</button><button data-a="+">+</button><button class="rm" data-a="x" title="Remove">🗑</button>`;
    d.onclick = e => { const a = e.target.dataset.a; if (!a) return; if (a === '+') l.q++; if (a === '-') l.q--; if (a === 'x' || l.q <= 0) cartLines.delete(l.p.id); beep([a === '+' ? 990 : 440], .06); updateCartUI(); rebuildBasket(); mp?.sendCart(cartIds()); }; L.appendChild(d); }
  $('#checkout').disabled = !c; }
$('#cartBtn').onclick = () => toggle('#cartPanel'); $('#mapBtn').onclick = () => toggle('#mapFull'); $('#searchBtn').onclick = () => openSearch();
$('#checkout').onclick = () => { const { c, t } = totals(); if (!c) return; const now = new Date(); const inv = 'RS-' + now.getTime().toString().slice(-7);
  let rows = ''; for (const l of cartLines.values()) rows += `<tr><td>${esc(l.p.name)}<br><small>${l.q} × ${fmt(l.p.price)}</small></td><td>${fmt(l.q * l.p.price)}</td></tr>`;
  $('#paper').innerHTML = `<h3>RAHIM STORE</h3><p style="text-align:center;margin:2px 0">Main Boulevard A.I.T. Lahore<br>Virtual Store Receipt</p><p>Invoice: ${inv}<br>${now.toLocaleString()}</p><hr><table>${rows}</table><hr><table><tr><td>Items</td><td>${c}</td></tr><tr><td><b>TOTAL</b></td><td><b>Rs ${fmt(t)}</b></td></tr></table><p style="text-align:center">Thank you for shopping!<br><small>Demo only – no payment taken. Prices from rahimstore.com.</small></p><button id="newShop">Start new shopping</button>`;
  $('#receipt').classList.remove('hidden'); $('#cartPanel').classList.add('hidden'); beep([660, 880, 1100, 1320], .12);
  $('#newShop').onclick = () => { cartLines.clear(); updateCartUI(); rebuildBasket(); mp?.sendCart([]); $('#receipt').classList.add('hidden'); teleportTo(MX, BOUND.z1 - 1.2, Math.PI); }; };
let toastT; function toast(s, bg = '#2e7d32') { const t = $('#toast'); t.textContent = s; t.style.background = bg; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, 1800); }

// ---------- map + search ----------
function drawMap(cv, full) { const g = cv.getContext('2d'), w = cv.width, h = cv.height, pad = full ? 16 : 6;
  const s = Math.min((w - pad * 2) / W, (h - pad * 2) / Dp), ox = (w - W * s) / 2, oz = (h - Dp * s) / 2; const P = (x, z) => [ox + (x - BOUND.x0) * s, oz + (z - BOUND.z0) * s]; cv._tf = { s, ox, oz };
  g.clearRect(0, 0, w, h); g.fillStyle = '#f7f3ea'; g.fillRect(...P(BOUND.x0, BOUND.z0), W * s, Dp * s); g.strokeStyle = '#555'; g.lineWidth = 2; g.strokeRect(...P(BOUND.x0, BOUND.z0), W * s, Dp * s);
  const cu = currentUnit();
  for (const u of units) { const [x, y] = P(u.cx - SHELF.len / 2, u.cz - SHELF.dep / 2); g.fillStyle = DEPTS[u.dept].color; g.globalAlpha = u === cu ? 1 : .8; g.fillRect(x, y, SHELF.len * s, Math.max(2, SHELF.dep * s)); g.globalAlpha = 1;
    if (full) { g.fillStyle = '#111'; g.font = '600 10px system-ui'; g.textAlign = 'center'; const [lx, ly] = P(u.cx, u.cz + SHELF.dep / 2 + 1.2); g.fillText('A' + (u.k + 1) + ' ' + u.subs[0].slice(0, 22), lx, ly); } }
  // department labels
  const dl = new Map(); for (const u of units) { const a = dl.get(u.dept) || { x: 0, z: 0, n: 0 }; a.x += u.cx; a.z += u.cz; a.n++; dl.set(u.dept, a); }
  if (full) for (const [d, a] of dl) { const [x, y] = P(a.x / a.n, a.z / a.n - 1.6); g.font = 'bold 15px system-ui'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#fff'; g.strokeText(DEPTS[d].name, x, y); g.fillStyle = DEPTS[d].color; g.fillText(DEPTS[d].name, x, y); }
  g.fillStyle = '#37474f'; for (const x of CK) { const [a, b] = P(x - .55, FRONT + 1.5); g.fillRect(a, b, 1.1 * s, 3.4 * s); }
  g.fillStyle = '#2e7d32'; g.textAlign = 'center'; g.font = `600 ${full ? 13 : 7}px system-ui`; g.fillText('ENTRANCE', ...P(MX, BOUND.z1 - .3));
  const tri = (x, z, hd, c, r) => { const [px, py] = P(x, z); g.save(); g.translate(px, py); g.rotate(-hd + Math.PI); g.fillStyle = c; g.beginPath(); g.moveTo(0, -r * 1.4); g.lineTo(r, r); g.lineTo(-r, r); g.closePath(); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); g.restore(); };
  for (const o of mp?.others() || []) { tri(o.x, o.z, o.h, o.color, full ? 7 : 4); if (full) { const [px, py] = P(o.x, o.z); g.fillStyle = '#000'; g.font = '11px system-ui'; g.fillText(o.name, px, py - 10); } }
  tri(player.x, player.z, player.h, '#d50000', full ? 11 : 6); }
$('#big').addEventListener('click', e => { const cv = e.target, r = cv.getBoundingClientRect(), k = Math.min(r.width / cv.width, r.height / cv.height); const offx = (r.width - cv.width * k) / 2, offy = (r.height - cv.height * k) / 2;
  const mx = (e.clientX - r.left - offx) / k, my = (e.clientY - r.top - offy) / k, { s, ox, oz } = cv._tf; const x = (mx - ox) / s + BOUND.x0, z = (my - oz) / s + BOUND.z0;
  const u = units.find(q => Math.abs(q.cx - x) < XP / 2 && Math.abs(q.cz - z) < ZP / 2); if (u) { goUnit(u, z < u.cz ? -1 : 1); $('#mapFull').classList.add('hidden'); } });
function goUnit(u, face = 1, x) { teleportTo(x ?? u.cx, u.cz + face * 3.0, face === 1 ? Math.PI : 0); toast('📍 Aisle ' + (u.k + 1) + ' · ' + DEPTS[u.dept].name, DEPTS[u.dept].color); }
function goProduct(p) { const u = units[p.unit]; goUnit(u, p.pos.face, p.pos.x); player.pitch = p.pos.y > 1.5 ? -.05 : p.pos.y < .5 ? -.55 : -.3; flash = { p, t: 2.5 }; }
function goCat(ci) { const p = CATS[ci].products[0]; goProduct(p); toast('📍 ' + CATS[ci].name, DEPTS[CATS[ci].dept].color); }
let flash = null;
function teleportTo(x, z, h) { player.x = x; player.z = z; player.h = h; player.v = 0; player.pitch = -.32; collide(); managePages(true); }
function currentUnit() { return units.find(q => Math.abs(q.cx - player.x) < XP / 2 && Math.abs(q.cz - player.z) < ZP / 2) || null; }
function openSearch() { $('#searchPanel').classList.remove('hidden'); const i = $('#q'); i.focus(); i.select(); renderSearch(); }
function renderSearch() { const q = $('#q').value.trim().toLowerCase(), out = $('#results'); let html = '';
  DEPTS.forEach((d, di) => { const cs = CATS.map((c, ci) => [c, ci]).filter(([c]) => c.dept === di && c.products?.length && (!q || c.name.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)));
    if (cs.length) html += `<div class="dh" style="border-color:${d.color}">${esc(d.name)}</div>` + cs.map(([c, ci]) => `<button data-c="${ci}"><span>${esc(c.name)}</span><small>${c.products.length}</small></button>`).join(''); });
  if (q.length >= 2) { const ps = PRODUCTS.filter(p => p.unit !== undefined && p.name.toLowerCase().includes(q)).slice(0, 40); if (ps.length) html += `<div class="dh">Products (${ps.length >= 40 ? '40+' : ps.length})</div>` + ps.map(p => `<button data-p="${p.i}"><span>${esc(p.name)}</span><small>Rs ${fmt(p.price)}</small></button>`).join(''); }
  out.innerHTML = html || '<p>No matches</p>'; }
$('#q').addEventListener('input', renderSearch);
$('#results').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.c) goCat(+b.dataset.c); else goProduct(PRODUCTS[+b.dataset.p]); $('#searchPanel').classList.add('hidden'); });

// ---------- physics ----------
function pushCircle(cx, cz, r) { let px = 0, pz = 0; const bx0 = BOUND.x0 + r, bx1 = BOUND.x1 - r, bz0 = BOUND.z0 + r, bz1 = BOUND.z1 - r;
  if (cx < bx0) px += bx0 - cx; if (cx > bx1) px += bx1 - cx; if (cz < bz0) pz += bz0 - cz; if (cz > bz1) pz += bz1 - cz;
  for (const b of colliders) { const x = cx + px, z = cz + pz; if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue; const nx = Math.max(b.x0, Math.min(b.x1, x)), nz = Math.max(b.z0, Math.min(b.z1, z)); const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz);
    if (d < r) { if (d > 1e-4) { px += dx / d * (r - d); pz += dz / d * (r - d); } else { const o = [b.x0 - x - r, b.x1 - x + r, b.z0 - z - r, b.z1 - z + r]; const k = o.map(Math.abs).indexOf(Math.min(...o.map(Math.abs))); if (k < 2) px += o[k]; else pz += o[k]; } } }
  return [px, pz]; }
function collide() { let hit = false; for (let it = 0; it < 4; it++) { const fx = Math.sin(player.h) * CF, fz = Math.cos(player.h) * CF;
  const [ax, az] = pushCircle(player.x, player.z, player.r), [bx, bz] = pushCircle(player.x + fx, player.z + fz, CR), [ex, ez] = pushCircle(player.x + fx * .5, player.z + fz * .5, .45);
  const px = ax + bx + ex, pz = az + bz + ez; if (Math.abs(px) + Math.abs(pz) < 1e-5) break; player.x += px; player.z += pz; hit = true; } return hit; }
let mapT = 0, pageT = 0, zoneName = '';
function step(dt) {
  const fwdIn = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y, turnIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - joy.x;
  const maxV = (keys.ShiftLeft || keys.ShiftRight) ? 7 : 3.6; const target = Math.max(-1, Math.min(1, fwdIn)) * maxV * (fwdIn < 0 ? .6 : 1);
  player.v += (target - player.v) * Math.min(1, dt * (target === 0 ? 5 : 2.6));
  player.h += Math.max(-1, Math.min(1, turnIn)) * dt * 2.1; if (keys.KeyQ) player.h += dt * 1.8; if (keys.KeyE) player.h -= dt * 1.8;
  const ox = player.x, oz = player.z; player.x += Math.sin(player.h) * player.v * dt; player.z += Math.cos(player.h) * player.v * dt;
  if (collide()) { const moved = Math.hypot(player.x - ox, player.z - oz); player.v = Math.sign(player.v) * Math.min(Math.abs(player.v), moved / Math.max(dt, 1e-3)); }
  cart.position.set(player.x + Math.sin(player.h) * CF, 0, player.z + Math.cos(player.h) * CF); cart.rotation.y = player.h; cart.updateMatrixWorld();
  if (rollGain) rollGain.gain.setTargetAtTime(Math.min(.25, Math.abs(player.v) * .04), actx.currentTime, .05);
  const bob = Math.sin(performance.now() / 160) * Math.min(.02, Math.abs(player.v) * .006);
  camera.position.set(Math.max(BOUND.x0 + .2, Math.min(BOUND.x1 - .2, player.x)), EYE + bob, Math.max(BOUND.z0 + .2, Math.min(BOUND.z1 - .2, player.z))); camera.rotation.set(player.pitch, player.h + Math.PI, 0);
  for (let i = flyers.length - 1; i >= 0; i--) { const f = flyers[i]; f.t += dt / .55; const to = new THREE.Vector3(0, 1, 0).applyMatrix4(f.cart.matrixWorld); const t = Math.min(1, f.t);
    f.m.position.lerpVectors(f.from, to, t); f.m.position.y += Math.sin(t * Math.PI) * 1.0; f.m.rotation.x += dt * 8; f.m.scale.setScalar(1 - t * .2); if (f.t >= 1) { flyers.splice(i, 1); scene.remove(f.m); putInBasket(f.cart, f.p); if (f.cart === cart) thud(); } }
  if (flash) { flash.t -= dt; hover = { p: flash.p, pos: new THREE.Vector3(flash.p.pos.x, flash.p.pos.y + heightOf(flash.p.shape) / 2, flash.p.pos.z), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, flash.p.pos.face === 1 ? 0 : Math.PI, 0)), near: true }; if (flash.t < 0) { flash = null; hover = null; } }
  if (hover && hover.near) { hl.visible = true; hl.position.copy(hover.pos); const s = hover.p.shape, hh = heightOf(s); hl.scale.set(s === 'can' || s === 'bottle' ? .24 : DIM[s][0] + .05, hh + .05, .24); hl.quaternion.copy(hover.rot); } else hl.visible = false;
  const u = currentUnit(); const nm = u ? `${DEPTS[u.dept].name} · Aisle ${u.k + 1}` : (player.z > FRONT ? 'Checkout & Entrance' : 'Main Aisle');
  if (nm !== zoneName) { zoneName = nm; $('#zoneTag').textContent = nm; $('#zoneTag').style.background = u ? DEPTS[u.dept].color : '#000a'; }
  mp?.update(dt, player);
  pageT -= dt; if (pageT <= 0) { pageT = .4; managePages(); }
  mapT -= dt; if (mapT <= 0) { mapT = .12; drawMap($('#mini'), false); if (!$('#mapFull').classList.contains('hidden')) drawMap($('#big'), true); } }
let running = false, last = performance.now();
function loop() { const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; if (running) step(dt); renderer.render(scene, camera); requestAnimationFrame(loop); }

// ---------- boot ----------
scene.updateMatrixWorld(true);
scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o === floor || o === ceil || o.parent?.parent === cart || o.parent === cart) return; const m = o.material; if (!m.vertexColors) return; const wp = new THREE.Vector3(); o.getWorldPosition(wp); o.geometry = bake(o.geometry.clone(), wp.y); });
teleportTo(player.x, player.z, player.h); camera.position.set(player.x, EYE, player.z); camera.rotation.set(-.32, 0, 0);
const nameIn = $('#pname'); nameIn.value = localStorage.getItem('rs3d_name') || ('Shopper' + Math.floor(Math.random() * 900 + 100));
{ const near = pages.filter(P => P && pageDist(P) < LOAD_R); let n = 0; $('#ptxt').textContent = `Stocking ${PRODUCTS.length.toLocaleString()} products…`;
  managePages(true); const tick = () => { n = near.filter(P => P.state === 2).length; $('#prog').style.width = (20 + 80 * n / Math.max(1, near.length)) + '%'; if (n < near.length) return setTimeout(tick, 150);
    $('#ptxt').textContent = `Ready – ${PRODUCTS.length.toLocaleString()} products · ${CATS.filter(c => c.products?.length).length} categories · ${DEPTS.length} departments`; const b = $('#go'); b.disabled = false; }; tick(); }
$('#go').onclick = () => { ensureAudio(); const name = (nameIn.value.trim() || 'Shopper').slice(0, 16); localStorage.setItem('rs3d_name', name); $('#start').classList.add('hidden'); $('#hud').classList.remove('hidden'); running = true; updateCartUI();
  mp = startMultiplayer({ THREE, scene, name, buildCart, putInBasket, clearBasket, byId, toast, getCart: cartIds, flyTo: (c, p, from) => { const m = new THREE.Mesh(GEO[p.shape], thumbMats(p)); m.position.copy(from); scene.add(m); flyers.push({ m, from: from.clone(), t: 0, p, cart: c }); }, setStatus: s => $('#mpStatus').innerHTML = s }); };
requestAnimationFrame(loop);
window.__game = { player, cartLines, PRODUCTS, CATS, DEPTS, units, pickAt, addToCart, goProduct, goCat, goUnit, teleportTo, totals, camera, keys, colliders, BOUND, pages, get mp() { return mp; }, loaded: () => !$('#go').disabled };
