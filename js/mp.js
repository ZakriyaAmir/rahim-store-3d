// Multiplayer: Supabase Realtime (broadcast + presence) only. Rooms of max 10.
export function startMultiplayer(o) {
  const { THREE, scene } = o; const qs = new URLSearchParams(location.search);
  const CAP = Math.min(10, Math.max(1, +qs.get('cap') || 10)), PREFIX = 'rahimstore3d-' + (qs.get('mpns') || 'v1') + '-room-';
  const me = { id: Math.random().toString(36).slice(2, 10), name: o.name, color: `hsl(${Math.floor(Math.random() * 360)},65%,50%)` };
  const peers = new Map(); let ch = null, client = null, room = 0, settled = false, sendT = 0, lastSent = '', lastSendAt = 0, offline = false, members = [];
  const status = () => o.setStatus(offline ? '⚪ Solo mode (multiplayer offline)' : !settled ? `🟡 Joining room ${room}…` : `🟢 Room ${room} · ${members.length}/${CAP} shoppers`);
  const api = { me, get room() { return room; }, get settled() { return settled; }, get offline() { return offline; }, members: () => members, peers,
    others: () => [...peers.values()].filter(p => p.av).map(p => ({ x: p.cur.x, z: p.cur.z, h: p.cur.h, name: p.name, color: p.color })),
    sendAdd(pid) { send('add', { pid }); }, sendCart(ids) { send('cart', { ids }); }, update };
  function send(event, payload) { if (ch && settled) ch.send({ type: 'broadcast', event, payload: { id: me.id, ...payload } }); }
  function goSolo(why) { if (offline) return; offline = true; settled = false; console.info('[mp] solo mode:', why); try { client?.removeAllChannels(); } catch (e) {} for (const id of [...peers.keys()]) dropPeer(id); status(); }
  if (!window.RS_MP || !window.supabase || qs.has('solo')) { offline = true; status(); return api; }
  try { client = window.supabase.createClient(window.RS_MP.url, window.RS_MP.key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 20 } } }); } catch (e) { goSolo(e.message); return api; }
  const joinTimer = setTimeout(() => { if (!settled) goSolo('timeout'); }, 12000);
  function readMembers() { const st = ch.presenceState(); members = Object.entries(st).map(([k, v]) => ({ id: k, ...v[0] })).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)); return members; }
  function join(n) { room = n; settled = false; status(); const t = Date.now();
    const c = ch = client.channel(PREFIX + n, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    c.on('presence', { event: 'sync' }, () => { if (c !== ch) return; readMembers(); const ids = new Set(members.map(m => m.id)); for (const id of [...peers.keys()]) if (!ids.has(id)) dropPeer(id);
        for (const m of members) if (m.id !== me.id) { const p = peer(m.id); p.name = m.name; p.color = m.color; }
        if (settled) checkCap(); status(); })
      .on('broadcast', { event: 'pos' }, ({ payload: d }) => { if (c !== ch || d.id === me.id) return; const p = peer(d.id); p.buf.push({ t: performance.now(), x: d.x, z: d.z, h: d.h }); if (p.buf.length > 20) p.buf.shift(); p.last = performance.now(); if (d.name) p.name = d.name; ensureAvatar(p); })
      .on('broadcast', { event: 'add' }, ({ payload: d }) => { const p = peers.get(d.id), it = o.byId.get(d.pid); if (!p || !it) return; ensureAvatar(p); p.ids.push(d.pid);
        if (p.av && it.pos) o.flyTo(p.av.cart, it, new THREE.Vector3(it.pos.x, it.pos.y + .2, it.pos.z)); else if (p.av) o.putInBasket(p.av.cart, it); o.toast(`🛒 ${p.name} added ${it.name}`, '#1565c0'); })
      .on('broadcast', { event: 'cart' }, ({ payload: d }) => { const p = peers.get(d.id); if (!p) return; p.ids = d.ids.slice(0, 200); ensureAvatar(p); if (p.av) { o.clearBasket(p.av.cart); for (const id of p.ids) { const it = o.byId.get(id); if (it) o.putInBasket(p.av.cart, it); } } })
      .on('broadcast', { event: 'hello' }, ({ payload: d }) => { if (c !== ch) return; peer(d.id); lastSent = ''; send('cart', { ids: o.getCart() }); })
      .subscribe(async s => { if (c !== ch) return;
        if (s === 'SUBSCRIBED') { await c.track({ name: me.name, color: me.color, t }); setTimeout(() => c === ch && checkCap(), 1500); }
        else if ((s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') && !settled) goSolo(s); }); }
  function checkCap() { if (offline) return; readMembers(); const idx = members.findIndex(m => m.id === me.id);
    if (idx === -1) { setTimeout(() => checkCap(), 700); return; }
    if (idx >= CAP) { // over capacity (incl. race): leave and try next room
      const old = ch; ch = null; settled = false; for (const id of [...peers.keys()]) dropPeer(id); old.untrack().finally(() => client.removeChannel(old)); join(room + 1); return; }
    if (!settled) { settled = true; clearTimeout(joinTimer); send('hello', { name: me.name }); lastSent = ''; send('cart', { ids: o.getCart() }); }
    status(); }
  function peer(id) { let p = peers.get(id); if (!p) { p = { id, name: 'Shopper', color: '#888', buf: [], ids: [], cur: { x: 0, z: 0, h: 0 }, last: performance.now(), walk: 0 }; peers.set(id, p); } return p; }
  function dropPeer(id) { const p = peers.get(id); if (p?.av) { scene.remove(p.av.root); p.av.root.traverse(x => x.geometry?.dispose()); } peers.delete(id); }
  function nameSprite(name, color) { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 20); g.fill(); g.fillStyle = color; g.beginPath(); g.arc(30, 32, 10, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 28px system-ui'; g.textBaseline = 'middle'; g.fillText(name.slice(0, 14), 48, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(1.2, .3, 1); s.renderOrder = 10; return s; }
  function ensureAvatar(p) { if (p.av || !p.buf.length) return; const root = new THREE.Group(); const col = new THREE.Color(p.color), dark = col.clone().multiplyScalar(.7);
    const M = c => new THREE.MeshBasicMaterial({ color: c }); const box = (w, h, d, m, x, y, z, parent = root) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); parent.add(b); return b; };
    const legs = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * .11, .85, 0); box(.14, .85, .16, M(0x2b3a55), 0, -.42, 0, g); box(.15, .08, .24, M(0x222222), 0, -.82, .04, g); root.add(g); return g; });
    box(.44, .62, .26, M(col), 0, 1.17, 0); box(.46, .1, .28, M(dark), 0, .9, 0); box(.24, .26, .24, M(0xc68e62), 0, 1.65, 0); box(.26, .08, .26, M(0x2d1b10), 0, 1.8, 0);
    for (const s of [-1, 1]) { const a = box(.11, .5, .11, M(dark), s * .27, 1.2, .2); a.rotation.x = -1.1; }
    const cart = o.buildCart(p.color, false); cart.position.z = 1.0; cart.scale.setScalar(.95); root.add(cart);
    const tag = nameSprite(p.name, p.color); tag.position.set(0, 2.15, 0); root.add(tag);
    const b = p.buf[p.buf.length - 1]; p.cur = { x: b.x, z: b.z, h: b.h }; root.position.set(b.x, 0, b.z); scene.add(root); p.av = { root, legs, cart };
    for (const id of p.ids) { const it = o.byId.get(id); if (it) o.putInBasket(cart, it); } }
  const lerpA = (a, b, t) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;
  function update(dt, pl) { if (offline || !ch) return;
    sendT -= dt; const now = performance.now(); const s = `${pl.x.toFixed(2)},${pl.z.toFixed(2)},${pl.h.toFixed(2)}`;
    if (settled && sendT <= 0 && (s !== lastSent || now - lastSendAt > 2000)) { sendT = .1; lastSent = s; lastSendAt = now; send('pos', { x: +pl.x.toFixed(2), z: +pl.z.toFixed(2), h: +pl.h.toFixed(3), name: me.name }); }
    const rt = now - 130; // render 130 ms in the past and interpolate between samples
    for (const p of peers.values()) { if (!p.av) continue; if (now - p.last > 20000) { dropPeer(p.id); continue; }
      const B = p.buf; let tgt = B[B.length - 1]; for (let i = B.length - 1; i > 0; i--) if (B[i - 1].t <= rt && B[i].t >= rt) { const a = B[i - 1], b = B[i], k = (rt - a.t) / Math.max(1, b.t - a.t); tgt = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, h: lerpA(a.h, b.h, k) }; break; }
      const k = 1 - Math.exp(-dt * 14), ox = p.cur.x, oz = p.cur.z; p.cur.x += (tgt.x - p.cur.x) * k; p.cur.z += (tgt.z - p.cur.z) * k; p.cur.h = lerpA(p.cur.h, tgt.h, k);
      const sp = Math.hypot(p.cur.x - ox, p.cur.z - oz) / Math.max(dt, 1e-3); p.walk += dt * sp * 4; const sw = Math.min(.6, sp * .25) * Math.sin(p.walk);
      p.av.legs[0].rotation.x = sw; p.av.legs[1].rotation.x = -sw; p.av.root.position.set(p.cur.x, 0, p.cur.z); p.av.root.rotation.y = p.cur.h; } }
  addEventListener('pagehide', () => { try { ch?.untrack(); client.removeAllChannels(); } catch (e) {} });
  join(1); return api;
}
