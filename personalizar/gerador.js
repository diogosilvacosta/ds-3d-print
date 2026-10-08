// DS 3D PRINT — gerador de porta-chaves / ímanes com nome (sem bibliotecas externas)
// 1) o browser desenha o texto com a fonte escolhida num canvas de alta resolução
// 2) calcula-se um campo de distâncias: contorno do texto, borda (offset) e argola
// 3) "marching squares" tira os contornos, que são triangulados (earcut) e extrudidos
// Saída: GLB (pré-visualização / realidade aumentada) e 3MF pronto a imprimir (base + texto)

// ------------------------------------------------------------------ earcut (port compacto do mapbox/earcut, ISC)
function earcut(data, holeIndices) {
  const dim = 2, hasHoles = holeIndices && holeIndices.length, outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true); const triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
  earcutLinked(outerNode, triangles, dim, 0);
  return triangles;
}
function Node(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = null; this.next = null; this.steiner = false; }
function insertNode(i, x, y, last) { const p = new Node(i, x, y); if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; } return p; }
function removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; }
function signedArea(data, start, end, dim) { let s = 0; for (let i = start, j = end - dim; i < end; i += dim) { s += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; } return s; }
function linkedList(data, start, end, dim, clockwise) {
  let last;
  if (clockwise === (signedArea(data, start, end, dim) > 0)) { for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last); }
  else { for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last); }
  if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
  return last;
}
function filterPoints(start, end) {
  if (!start) return start; if (!end) end = start;
  let p = start, again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) { removeNode(p); p = end = p.prev; if (p === p.next) break; again = true; }
    else p = p.next;
  } while (again || p !== end);
  return end;
}
function earcutLinked(ear, triangles, dim, pass) {
  if (!ear) return;
  let stop = ear;
  while (ear.prev !== ear.next) {
    const prev = ear.prev, next = ear.next;
    if (isEar(ear)) { triangles.push(prev.i / dim | 0, ear.i / dim | 0, next.i / dim | 0); removeNode(ear); ear = next.next; stop = next.next; continue; }
    ear = next;
    if (ear === stop) {
      if (!pass) earcutLinked(filterPoints(ear), triangles, dim, 1);
      else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), triangles, dim); earcutLinked(ear, triangles, dim, 2); }
      else if (pass === 2) splitEarcut(ear, triangles, dim);
      break;
    }
  }
}
function isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const x0 = Math.min(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y), x1 = Math.max(a.x, b.x, c.x), y1 = Math.max(a.y, b.y, c.y);
  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}
function cureLocalIntersections(start, triangles, dim) {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i / dim | 0, p.i / dim | 0, b.i / dim | 0); removeNode(p); removeNode(p.next); p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}
function splitEarcut(start, triangles, dim) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next); c = filterPoints(c, c.next);
        earcutLinked(a, triangles, dim, 0); earcutLinked(c, triangles, dim, 0); return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
function eliminateHoles(data, holeIndices, outerNode, dim) {
  const queue = [];
  for (let i = 0; i < holeIndices.length; i++) {
    const start = holeIndices[i] * dim, end = i < holeIndices.length - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x);
  for (const h of queue) outerNode = eliminateHole(h, outerNode);
  return outerNode;
}
function eliminateHole(hole, outerNode) {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}
function findHoleBridge(hole, outerNode) {
  let p = outerNode, qx = -Infinity, m;
  const hx = hole.x, hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;
  const stop = m, mx = m.x, my = m.y; let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) { m = p; tanMin = tan; }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}
function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
function getLeftmost(start) { let p = start, l = start; do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p; p = p.next; } while (p !== start); return l; }
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) { return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py); }
function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
     (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
}
function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
function equals(a, b) { return a.x === b.x && a.y === b.y; }
function sgn(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function onSegment(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
function intersects(p1, q1, p2, q2) {
  const o1 = sgn(area(p1, q1, p2)), o2 = sgn(area(p1, q1, q2)), o3 = sgn(area(p2, q2, p1)), o4 = sgn(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}
function intersectsPolygon(a, b) { let p = a; do { if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true; p = p.next; } while (p !== a); return false; }
function locallyInside(a, b) { return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0; }
function middleInside(a, b) {
  let p = a, inside = false; const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do { if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside; p = p.next; } while (p !== a);
  return inside;
}
function splitPolygon(a, b) {
  const a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
  a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp;
  return b2;
}

// ------------------------------------------------------------------ distância euclidiana exata (Felzenszwalb)
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(inside, W, H) { // devolve distância (px) até ao pixel "inside" mais próximo
  const INF = 1e20, out = new Float32Array(W * H), n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = inside[y * W + x] ? 0 : INF;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = out[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

// ------------------------------------------------------------------ marching squares -> laços fechados
function contours(F, W, H) {
  // F: valores nos centros dos pixels; dentro = F < 0. A moldura exterior é considerada "fora".
  const val = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 1 : F[j * W + i];
  const W1 = W + 2; // ids das arestas na grelha alargada (-1..W)
  const hId = (i, j) => (((j + 1) * W1 + (i + 1)) * 2);       // aresta horizontal entre (i,j) e (i+1,j)
  const vId = (i, j) => (((j + 1) * W1 + (i + 1)) * 2 + 1);   // aresta vertical entre (i,j) e (i,j+1)
  const pts = new Map(), adj = new Map();
  const pt = (id, ax, ay, bx, by, fa, fb) => { if (!pts.has(id)) { const t = fa / (fa - fb); pts.set(id, [ax + (bx - ax) * t, ay + (by - ay) * t]); } };
  const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
  for (let j = -1; j < H; j++) for (let i = -1; i < W; i++) {
    const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
    const code = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const T = hId(i, j), B = hId(i, j + 1), L = vId(i, j), R = vId(i + 1, j);
    const need = (e) => {
      if (e === T) pt(T, i, j, i + 1, j, a, b);
      else if (e === B) pt(B, i, j + 1, i + 1, j + 1, d, c);
      else if (e === L) pt(L, i, j, i, j + 1, a, d);
      else pt(R, i + 1, j, i + 1, j + 1, b, c);
    };
    const seg = (e1, e2) => { need(e1); need(e2); link(e1, e2); };
    const centre = (a + b + c + d) / 4 < 0;
    switch (code) {
      case 1: seg(L, T); break; case 2: seg(T, R); break; case 3: seg(L, R); break; case 4: seg(R, B); break;
      case 5: if (centre) { seg(T, R); seg(B, L); } else { seg(L, T); seg(R, B); } break;
      case 6: seg(T, B); break; case 7: seg(L, B); break; case 8: seg(B, L); break; case 9: seg(T, B); break;
      case 10: if (centre) { seg(L, T); seg(R, B); } else { seg(T, R); seg(B, L); } break;
      case 11: seg(R, B); break; case 12: seg(L, R); break; case 13: seg(T, R); break; case 14: seg(L, T); break;
    }
  }
  const loops = [], seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur); loop.push(pts.get(cur));
      const nb = adj.get(cur); const nxt = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur; cur = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ------------------------------------------------------------------ geometria 2D
function polyArea(p) { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]); return s / 2; } // >0 = CCW (y para cima)
function pointInPoly(x, y, p) { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if (((p[i][1] > y) !== (p[j][1] > y)) && (x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) ins = !ins; } return ins; }
function simplify(loop, tol) { // Douglas-Peucker num laço fechado
  if (loop.length < 8) return loop;
  let far = 0, fd = -1; for (let i = 1; i < loop.length; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const rdp = (pts) => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) {
      const [s, e] = st.pop(); const [ax, ay] = pts[s], [bx, by] = pts[e]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
      let md = -1, mi = -1;
      for (let i = s + 1; i < e; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const a = rdp(loop.slice(0, far + 1)), b = rdp(loop.slice(far).concat([loop[0]]));
  return a.slice(0, -1).concat(b.slice(0, -1));
}
// agrupa laços em "formas" (contorno exterior + buracos) e orienta-os: exterior CCW, buracos CW
function shapesFrom(loops) {
  const L = loops.map(p => ({ p, a: Math.abs(polyArea(p)), depth: 0, parent: -1 }));
  L.sort((x, y) => y.a - x.a);
  for (let i = 0; i < L.length; i++) {
    const [x, y] = L[i].p[0];
    for (let j = i - 1; j >= 0; j--) if (pointInPoly(x, y, L[j].p)) { L[i].parent = j; L[i].depth = L[j].depth + 1; break; }
  }
  const shapes = [];
  L.forEach((l, i) => {
    const ccw = polyArea(l.p) > 0;
    if (l.depth % 2 === 0) { l.shape = shapes.length; shapes.push({ outer: ccw ? l.p : l.p.slice().reverse(), holes: [] }); }
  });
  L.forEach(l => { if (l.depth % 2 === 1) { const par = L[l.parent]; shapes[par.shape].holes.push(polyArea(l.p) > 0 ? l.p.slice().reverse() : l.p); } });
  return shapes;
}

// ------------------------------------------------------------------ extrusão -> malha (mm, Z para cima)
function extrude(shapes, z0, z1, mesh) {
  const cosT = Math.cos(40 * Math.PI / 180);
  const P = mesh.pos, N = mesh.nor, I = mesh.idx;
  const v = (x, y, z, nx, ny, nz) => { P.push(x, y, z); N.push(nx, ny, nz); return P.length / 3 - 1; };
  for (const s of shapes) {
    // tampas
    const flat = [], holesIdx = [];
    for (const p of s.outer) flat.push(p[0], p[1]);
    for (const h of s.holes) { holesIdx.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
    const tri = earcut(flat, holesIdx);
    const n = flat.length / 2;
    const top = [], bot = [];
    for (let k = 0; k < n; k++) { top.push(v(flat[2 * k], flat[2 * k + 1], z1, 0, 0, 1)); bot.push(v(flat[2 * k], flat[2 * k + 1], z0, 0, 0, -1)); }
    for (let t = 0; t < tri.length; t += 3) {
      let a = tri[t], b = tri[t + 1], c = tri[t + 2];
      const cz = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
      if (cz < 0) [b, c] = [c, b];
      I.push(top[a], top[b], top[c]); I.push(bot[a], bot[c], bot[b]);
    }
    // paredes
    for (const loop of [s.outer, ...s.holes]) {
      const m = loop.length, en = [];
      for (let i = 0; i < m; i++) { const a = loop[i], b = loop[(i + 1) % m]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; en.push([dy / l, -dx / l]); }
      const blend = (n1, n2) => { if (n1[0] * n2[0] + n1[1] * n2[1] > cosT) { const x = n1[0] + n2[0], y = n1[1] + n2[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; } return n2; };
      for (let i = 0; i < m; i++) {
        const a = loop[i], b = loop[(i + 1) % m], ni = en[i];
        const na = blend(en[(i - 1 + m) % m], ni), nb0 = blend(en[(i + 1) % m], ni);
        const a0 = v(a[0], a[1], z0, na[0], na[1], 0), b0 = v(b[0], b[1], z0, nb0[0], nb0[1], 0);
        const b1 = v(b[0], b[1], z1, nb0[0], nb0[1], 0), a1 = v(a[0], a[1], z1, na[0], na[1], 0);
        I.push(a0, b0, b1, a0, b1, a1);
      }
    }
  }
}

// ------------------------------------------------------------------ GLB (pré-visualização) e 3MF (impressão)
const srgb = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const hexLin = (h) => { const n = parseInt(h.replace('#', ''), 16); return [srgb(n >> 16), srgb((n >> 8) & 255), srgb(n & 255)]; };

function toGLB(parts) { // parts: [{mesh:{pos,nor,idx}, hex, rough, metal}] em mm Z-up -> glTF m Y-up
  const chunks = []; let off = 0; const views = [], accs = [], prims = [], mats = [];
  const push = (arr, target) => { const b = new Uint8Array(arr.buffer); views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength, target }); chunks.push(b); off += b.byteLength; return views.length - 1; };
  parts.forEach((pt, k) => {
    const n = pt.mesh.pos.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = pt.mesh.pos[3 * i] / 1000, y = pt.mesh.pos[3 * i + 2] / 1000, z = -pt.mesh.pos[3 * i + 1] / 1000;
      pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z;
      nor[3 * i] = pt.mesh.nor[3 * i]; nor[3 * i + 1] = pt.mesh.nor[3 * i + 2]; nor[3 * i + 2] = -pt.mesh.nor[3 * i + 1];
      mn[0] = Math.min(mn[0], x); mn[1] = Math.min(mn[1], y); mn[2] = Math.min(mn[2], z); mx[0] = Math.max(mx[0], x); mx[1] = Math.max(mx[1], y); mx[2] = Math.max(mx[2], z);
    }
    const idx = new Uint32Array(pt.mesh.idx);
    const pv = push(pos, 34962), nv = push(nor, 34962), iv = push(idx, 34963);
    accs.push({ bufferView: pv, componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx }, { bufferView: nv, componentType: 5126, count: n, type: 'VEC3' }, { bufferView: iv, componentType: 5125, count: idx.length, type: 'SCALAR' });
    mats.push({ name: pt.nome || 'parte' + k, pbrMetallicRoughness: { baseColorFactor: [...hexLin(pt.hex), 1], metallicFactor: pt.metal || 0, roughnessFactor: pt.rough ?? 0.6 } });
    prims.push({ attributes: { POSITION: 3 * k, NORMAL: 3 * k + 1 }, indices: 3 * k + 2, material: k });
  });
  const gltf = { asset: { version: '2.0', generator: 'DS 3D PRINT' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: prims }], materials: mats, buffers: [{ byteLength: off }], bufferViews: views, accessors: accs };
  const js = new TextEncoder().encode(JSON.stringify(gltf)), jl = js.length + ((4 - js.length % 4) % 4);
  const out = new Uint8Array(12 + 8 + jl + 8 + off), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); out.fill(0x20, 20, 20 + jl); out.set(js, 20);
  let p = 20 + jl; dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004E4942, true); p += 8;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) { // [{name, data(Uint8Array)}] sem compressão
  const enc = new TextEncoder(); const local = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), h = new Uint8Array(30 + nm.length), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true); dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true); dv.setUint32(22, f.data.length, true); dv.setUint16(26, nm.length, true); h.set(nm, 30);
    const c = new Uint8Array(46 + nm.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true); c.set(nm, 46);
    local.push(h, f.data); central.push(c); off += h.length + f.data.length;
  }
  const cs = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cs, true); ev.setUint32(16, off, true);
  const all = [...local, ...central, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
function to3MF(parts, titulo) {
  // malhas soldadas por posição (o slicer precisa de vértices partilhados)
  const objs = parts.map((pt, k) => {
    const map = new Map(), V = [], T = [], P = pt.mesh.pos, key = (i) => `${P[3 * i].toFixed(4)},${P[3 * i + 1].toFixed(4)},${P[3 * i + 2].toFixed(4)}`;
    const vid = (i) => { const k2 = key(i); let id = map.get(k2); if (id === undefined) { id = V.length; map.set(k2, id); V.push(k2.split(',')); } return id; };
    for (let t = 0; t < pt.mesh.idx.length; t += 3) { const a = vid(pt.mesh.idx[t]), b = vid(pt.mesh.idx[t + 1]), c = vid(pt.mesh.idx[t + 2]); if (a !== b && b !== c && a !== c) T.push([a, b, c]); }
    return `<object id="${k + 1}" type="model" name="${pt.nome}"><mesh><vertices>${V.map(v => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices><triangles>${T.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`;
  });
  const comp = `<object id="${parts.length + 1}" type="model" name="${titulo.replace(/[<&"]/g, '')}"><components>${parts.map((_, k) => `<component objectid="${k + 1}"/>`).join('')}</components></object>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="pt-PT" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${titulo.replace(/[<&]/g, '')}</metadata><metadata name="Designer">DS 3D PRINT</metadata><resources>${objs.join('')}${comp}</resources><build><item objectid="${parts.length + 1}" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}

// ------------------------------------------------------------------ gerador principal
export const PREDEFINICOES = {
  'porta-chaves': { borda: 2.6, fecho: 3.0, base: 3.0, relevo: 1.6, argola: true, furo: 4.6, paredeArgola: 2.4 },
  'iman':         { borda: 1.4, fecho: 4.0, base: 2.0, relevo: 1.4, argola: false },
};

export function gerar(opts) {
  const o = { texto: 'Nome', fonte: '700 "Fredoka"', alturaLetra: 14, tipo: 'porta-chaves', pxPorMM: 14, ...opts };
  const cfg = { ...PREDEFINICOES[o.tipo], ...(o.cfg || {}) };
  const S = o.pxPorMM, texto = (o.texto || '').trim() || ' ';
  // medir: o tamanho de letra é definido pela altura de uma maiúscula ("H")
  const cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  let ctx = cv.getContext('2d', { willReadFrequently: true });
  const fontStr = (px) => { const m = o.fonte.match(/^(\d{3})?\s*(.*)$/); return `${m[1] || 400} ${px}px ${m[2]}`; };
  ctx.font = fontStr(100);
  const H100 = ctx.measureText('H').actualBoundingBoxAscent || 70;
  const fontPx = (o.alturaLetra * S) * 100 / H100;
  ctx.font = fontStr(fontPx);
  const mt = ctx.measureText(texto);
  const inkL = mt.actualBoundingBoxLeft, inkR = mt.actualBoundingBoxRight, asc = mt.actualBoundingBoxAscent, desc = mt.actualBoundingBoxDescent;
  const R = cfg.argola ? (cfg.furo / 2 + cfg.paredeArgola) : 0;
  const marg = Math.ceil((cfg.borda + cfg.fecho + 2 * R + 2) * S);
  const W = Math.ceil(inkL + inkR + 2 * marg), Hh = Math.ceil(asc + desc + 2 * marg);
  if (W * Hh > 14e6) throw new Error('Texto demasiado grande.');
  cv.width = W; cv.height = Hh;
  ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, Hh);
  ctx.font = fontStr(fontPx); ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  const ox = marg + inkL, oy = marg + asc;
  ctx.fillText(texto, ox, oy);
  const img = ctx.getImageData(0, 0, W, Hh).data;
  const N = W * Hh, Ft = new Float32Array(N), ins = new Uint8Array(N);
  let minX = W, maxX = 0, minY = Hh, maxY = 0;
  for (let i = 0; i < N; i++) {
    const a = img[4 * i] / 255; Ft[i] = 0.5 - a;
    if (a >= 0.5) { ins[i] = 1; const x = i % W, y = (i / W) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < minX) throw new Error('Escreve pelo menos uma letra.');
  // placa = texto alargado pela borda (+ argola, - furo)
  // borda + "fecho" (dilatar e depois encolher) para unir palavras e letras soltas numa só base
  const D = edt(ins, W, Hh), dil = new Uint8Array(N), rc = cfg.fecho;
  for (let i = 0; i < N; i++) dil[i] = D[i] / S <= cfg.borda + rc ? 0 : 1;   // 1 = fora da base dilatada
  const Dc = edt(dil, W, Hh), Fp = new Float32Array(N);
  const cx = minX - (cfg.borda + R * 0.35) * S, cy = (minY + maxY) / 2;
  for (let i = 0; i < N; i++) {
    let f = rc - Dc[i] / S;
    if (cfg.argola) {
      const x = i % W, y = (i / W) | 0, r = Math.hypot(x - cx, y - cy) / S;
      f = Math.min(f, r - R); f = Math.max(f, cfg.furo / 2 - r);
    }
    Fp[i] = f;
  }
  // contornos em mm (y para cima), centrados
  const tol = 0.025;
  const toMM = (loops) => loops.map(l => simplify(l.map(([x, y]) => [x / S, -y / S]), tol)).filter(l => l.length >= 3 && Math.abs(polyArea(l)) > 0.04);
  let lt = toMM(contours(Ft, W, Hh)), lp = toMM(contours(Fp, W, Hh));
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const l of lp) for (const [x, y] of l) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
  const shift = (ls) => ls.map(l => l.map(([x, y]) => [x - mx, y - my]));
  lt = shift(lt); lp = shift(lp);
  const base = { pos: [], nor: [], idx: [] }, letras = { pos: [], nor: [], idx: [] };
  extrude(shapesFrom(lp), 0, cfg.base, base);
  extrude(shapesFrom(lt), cfg.base, cfg.base + cfg.relevo, letras);
  return {
    base, letras,
    medidas: { largura: +(bx1 - bx0).toFixed(1), altura: +(by1 - by0).toFixed(1), espessura: +(cfg.base + cfg.relevo).toFixed(1) },
    triangulos: (base.idx.length + letras.idx.length) / 3,
  };
}

export function glbDe(r, corBase, corTexto) {
  return toGLB([{ mesh: r.base, hex: corBase.hex, rough: corBase.rough, metal: corBase.metal, nome: 'base' }, { mesh: r.letras, hex: corTexto.hex, rough: corTexto.rough, metal: corTexto.metal, nome: 'texto' }]);
}
export function tresMFDe(r, titulo, nomeBase = 'Base', nomeTexto = 'Texto') {
  return to3MF([{ mesh: r.base, nome: nomeBase }, { mesh: r.letras, nome: nomeTexto }], titulo);
}
