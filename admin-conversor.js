// DS 3D PRINT — conversor STL/3MF -> GLB de pré-visualização (corre no browser e no Node 18+)
// - escala real (mm -> m), Y para cima, centrado, assente no chão
// - 3MF: cores dos filamentos (Bambu/Orca/Prusa), peças, transformações e pintura multicor
// - proteção: modelos pesados perdem detalhe; todos levam um desvio invisível (~0,15 mm) nos vértices

const td = new TextDecoder();

// ---------------------------------------------------------------- ZIP (3MF)
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este browser não descomprime 3MF.');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([u8]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('O ficheiro 3MF parece estar danificado.');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name.replace(/^\/+/, '')] = { method, csize, lho };
    p += 46 + nlen + xlen + clen;
  }
  const get = async (name) => {
    const f = files[name.replace(/^\/+/, '')]; if (!f) return null;
    const ln = dv.getUint16(f.lho + 26, true), lx = dv.getUint16(f.lho + 28, true);
    const data = u8.subarray(f.lho + 30 + ln + lx, f.lho + 30 + ln + lx + f.csize);
    return f.method === 0 ? data : await inflateRaw(data);
  };
  return { names: Object.keys(files), get, text: async (n) => { const b = await get(n); return b ? td.decode(b) : null; } };
}

// ---------------------------------------------------------------- matrizes 3MF (3x4, linha a linha)
const I4 = [1,0,0, 0,1,0, 0,0,1, 0,0,0];
const parseT = (s) => s ? s.trim().split(/\s+/).map(Number) : I4.slice();
// 3MF: p' = p * M  (vetor-linha); M = [m00 m01 m02; m10 m11 m12; m20 m21 m22; m30 m31 m32]
function mul(a, b) { // a depois b
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    r[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j] + (i === 3 ? b[9+j] : 0);
  }
  return r;
}
const apply = (m, x, y, z) => [x*m[0]+y*m[3]+z*m[6]+m[9], x*m[1]+y*m[4]+z*m[7]+m[10], x*m[2]+y*m[5]+z*m[8]+m[11]];
const attr = (tag, a) => { const m = tag.match(new RegExp('\\s' + a + '="([^"]*)"')); return m ? m[1] : null; };

// ---------------------------------------------------------------- pintura multicor (TriangleSelector do PrusaSlicer/Bambu)
// cada nibble: bits0-1 = nº de lados divididos; bits2-3 = lado especial (se dividido) ou estado (folha; 3 = estendido)
function paintLeaves(hex, A, B, C, out) {
  let pos = hex.length - 1;
  const nib = () => { if (pos < 0) return 0; return parseInt(hex[pos--], 16); };
  const mid = (p, q) => [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
  const rec = (v, depth) => {
    const c = nib(), split = c & 3, hi = c >> 2;
    if (split === 0) {
      let st = hi;
      if (st === 3) { let n = nib(); let add = 0; while (n === 15) { add += 15; n = nib(); } st = 3 + n + add; }
      out.push([v[0], v[1], v[2], st]); return;
    }
    const s = hi, v0 = v[s], v1 = v[(s+1)%3], v2 = v[(s+2)%3];
    let kids;
    if (split === 1) { const m = mid(v1, v2); kids = [[v0, v1, m], [m, v2, v0]]; }
    else if (split === 2) { const a = mid(v0, v1), b = mid(v2, v0); kids = [[v0, a, b], [a, v1, b], [v1, v2, b]]; }
    else { const a = mid(v0, v1), b = mid(v1, v2), d = mid(v2, v0); kids = [[v0, a, d], [a, v1, b], [b, v2, d], [a, b, d]]; }
    // os filhos estão guardados do último para o primeiro
    for (let i = kids.length - 1; i >= 0; i--) rec(kids[i], depth + 1);
  };
  rec([A, B, C], 0);
}

// ---------------------------------------------------------------- leitura STL
function readSTL(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const tris = [];
  if (84 + n * 50 === buf.byteLength) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12; const t = [];
      for (let k = 0; k < 3; k++) t.push([dv.getFloat32(o+k*12, true), dv.getFloat32(o+k*12+4, true), dv.getFloat32(o+k*12+8, true)]);
      tris.push([t[0], t[1], t[2], 0]);
    }
  } else {
    const s = td.decode(u8); const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m, v = [];
    while ((m = re.exec(s))) { v.push([+m[1], +m[2], +m[3]]); if (v.length === 3) { tris.push([v[0], v[1], v[2], 0]); v = []; } }
  }
  if (!tris.length) throw new Error('Não encontrei triângulos neste STL.');
  return { tris, palette: { 0: null } };
}

// ---------------------------------------------------------------- leitura 3MF
async function read3MF(buf) {
  const z = await unzip(buf);
  const rootName = z.names.find(n => /^3D\/[^/]*\.model$/i.test(n)) || '3D/3dmodel.model';
  const modelCache = {};
  const loadModel = async (path) => {
    path = path.replace(/^\/+/, '');
    if (modelCache[path]) return modelCache[path];
    const xml = await z.text(path); if (!xml) throw new Error('Falta ' + path + ' no 3MF.');
    const objects = {}; const baseMats = {};
    // materiais base / grupos de cor (3MF genérico)
    for (const bm of xml.matchAll(/<(?:\w+:)?(basematerials|colorgroup)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
      const id = attr(bm[2], 'id'); const cols = [];
      for (const b of bm[3].matchAll(/<(?:\w+:)?(?:base|color)\b([^>]*)\/>/g)) cols.push(attr(b[1], 'displaycolor') || attr(b[1], 'color'));
      baseMats[id] = cols;
    }
    for (const om of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = attr(om[1], 'id'), body = om[2];
      const o = { id, pid: attr(om[1], 'pid'), pindex: attr(om[1], 'pindex'), comps: [], mesh: null };
      for (const c of body.matchAll(/<component\b([^>]*)\/?>/g)) {
        o.comps.push({ path: attr(c[1], 'p:path') || path, objectid: attr(c[1], 'objectid'), t: parseT(attr(c[1], 'transform')) });
      }
      const vm = body.match(/<vertices>([\s\S]*?)<\/vertices>/);
      if (vm) {
        const V = [];
        for (const v of vm[1].matchAll(/<vertex\b([^>]*)\/>/g)) V.push([+attr(v[1], 'x'), +attr(v[1], 'y'), +attr(v[1], 'z')]);
        const T = [];
        for (const t of body.matchAll(/<triangle\b([^>]*)\/>/g)) {
          const a = t[1];
          T.push({ v: [+attr(a, 'v1'), +attr(a, 'v2'), +attr(a, 'v3')],
            paint: attr(a, 'paint_color') || attr(a, 'slic3rpe:mmu_segmentation') || attr(a, 'mmu_segmentation'),
            pid: attr(a, 'pid'), p1: attr(a, 'p1') });
        }
        o.mesh = { V, T };
      }
      objects[id] = o;
    }
    return (modelCache[path] = { objects, baseMats });
  };

  // extrusores por objeto/peça (Bambu/Orca: Metadata/model_settings.config; Prusa: Slic3r_PE_model.config)
  const cfg = (await z.text('Metadata/model_settings.config')) || (await z.text('Metadata/Slic3r_PE_model.config')) || '';
  const objExt = {}, partExt = {};
  for (const om of cfg.matchAll(/<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const before = om[2].split(/<(?:part|volume)\b/)[0];
    const e = before.match(/key="extruder"\s+value="(\d+)"/); if (e) objExt[om[1]] = +e[1];
    for (const pm of om[2].matchAll(/<part\s+id="(\d+)"[^>]*>([\s\S]*?)<\/part>/g)) {
      const pe = pm[2].match(/key="extruder"\s+value="(\d+)"/); if (pe) partExt[pm[1]] = +pe[1];
    }
  }
  // cores dos filamentos
  let fil = [];
  const ps = await z.text('Metadata/project_settings.config');
  if (ps) {
    try { const j = JSON.parse(ps); fil = j.filament_colour || j.extruder_colour || []; }
    catch { const m = ps.match(/^;?\s*(?:filament|extruder)_colour\s*=\s*(.+)$/m); if (m) fil = m[1].split(';'); }
  }
  const silk = [];
  if (ps) { try { const j = JSON.parse(ps); (j.filament_settings_id || []).forEach((s, i) => silk[i] = /silk/i.test(s)); } catch {} }

  const root = await loadModel(rootName);
  const buildRe = /<item\b([^>]*)\/?>/g; const rootXml = await z.text(rootName);
  const items = [...rootXml.matchAll(buildRe)].filter(m => attr(m[1], 'printable') !== '0');
  const tris = [];
  const palette = {}; // chave -> {hex, silk}
  const keyFor = (ext, extra) => { // ext: 1-based extrusor; extra: hex direto
    if (extra) { palette['c' + extra] = { hex: extra.slice(0, 7) }; return 'c' + extra; }
    const hex = fil[(ext || 1) - 1]; if (!hex) { palette[0] = null; return 0; }
    palette['e' + ext] = { hex, silk: !!silk[(ext || 1) - 1] }; return 'e' + ext;
  };
  const walk = async (path, oid, M, ext, topId) => {
    const mdl = await loadModel(path); const o = mdl.objects[oid]; if (!o) return;
    const myExt = partExt[oid] ?? (o.comps.length ? objExt[oid] : undefined) ?? ext;
    for (const c of o.comps) await walk(c.path, c.objectid, mul(c.t, M), myExt, topId);
    if (!o.mesh) return;
    const { V, T } = o.mesh; const W = V.map(p => apply(M, p[0], p[1], p[2]));
    for (const t of T) {
      const A = W[t.v[0]], B = W[t.v[1]], C = W[t.v[2]];
      let directHex = null;
      const pid = t.pid || o.pid, pi = t.p1 ?? o.pindex;
      if (pid && mdl.baseMats[pid] && pi != null) directHex = mdl.baseMats[pid][+pi] || null;
      if (t.paint && fil.length) {
        const leaves = []; paintLeaves(t.paint, A, B, C, leaves);
        for (const l of leaves) tris.push([l[0], l[1], l[2], keyFor(l[3] || myExt)]);
      } else tris.push([A, B, C, keyFor(directHex ? null : myExt, directHex)]);
    }
  };
  for (const it of items) {
    const oid = attr(it[1], 'objectid');
    await walk(attr(it[1], 'p:path') || rootName, oid, parseT(attr(it[1], 'transform')), objExt[oid] ?? 1, oid);
  }
  if (!tris.length) throw new Error('Não encontrei peças imprimíveis neste 3MF.');
  return { tris, palette };
}

// ---------------------------------------------------------------- GLB
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function hexToLin(h) { const n = parseInt(h.replace('#', '').slice(0, 6), 16); return [srgbToLin(n >> 16), srgbToLin((n >> 8) & 255), srgbToLin(n & 255)]; }

function buildGLB(groups) {
  const chunks = []; let off = 0; const views = [], accs = [], prims = [], mats = [];
  const push = (arr, target) => { const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); views.push({ buffer: 0, byteOffset: off, byteLength: b.byteLength, target }); chunks.push(b); off += b.byteLength; const pad = (4 - off % 4) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } return views.length - 1; };
  groups.forEach((g, gi) => {
    const pv = push(g.pos, 34962), nv = push(g.nor, 34962), iv = push(g.idx, 34963);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.pos[i+k]); mx[k] = Math.max(mx[k], g.pos[i+k]); }
    accs.push({ bufferView: pv, componentType: 5126, count: g.pos.length / 3, type: 'VEC3', min: mn, max: mx });
    accs.push({ bufferView: nv, componentType: 5126, count: g.nor.length / 3, type: 'VEC3' });
    accs.push({ bufferView: iv, componentType: 5125, count: g.idx.length, type: 'SCALAR' });
    const base = g.hex ? hexToLin(g.hex) : hexToLin('#eeeeea');
    mats.push({ name: g.hex ? 'cor ' + g.hex : 'PLA', pbrMetallicRoughness: { baseColorFactor: [...base, 1], metallicFactor: g.silk ? 0.35 : 0, roughnessFactor: g.silk ? 0.32 : 0.62 } });
    prims.push({ attributes: { POSITION: gi*3, NORMAL: gi*3+1 }, indices: gi*3+2, material: gi });
  });
  const gltf = { asset: { version: '2.0', generator: 'DS 3D PRINT' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'modelo' }],
    meshes: [{ primitives: prims }], materials: mats, buffers: [{ byteLength: off }], bufferViews: views, accessors: accs };
  let json = new TextEncoder().encode(JSON.stringify(gltf)); const jp = (4 - json.length % 4) % 4;
  const jsonP = new Uint8Array(json.length + jp).fill(0x20); jsonP.set(json);
  const total = 12 + 8 + jsonP.length + 8 + off; const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonP.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jsonP, 20);
  let p = 20 + jsonP.length; dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004E4942, true); p += 8;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}

// ---------------------------------------------------------------- pipeline
// rng determinístico
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export async function convert(buf, filename, opts = {}) {
  const maxTris = opts.maxTris ?? 350000, jitterMM = opts.jitterMM ?? 0.15;
  const is3mf = /\.3mf$/i.test(filename);
  const { tris, palette } = is3mf ? await read3MF(buf) : readSTL(buf);
  const R = rng(7);

  // bounding box em mm
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], t[k][a]); mx[a] = Math.max(mx[a], t[k][a]); }
  const size = [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]];
  const ctr = [(mn[0]+mx[0])/2, (mn[1]+mx[1])/2];

  const nIn = tris.length;
  // agrupar vértices numa grelha (chaves numéricas = rápido); célula mínima = soldar vértices iguais
  const maxSide = Math.max(...size, 1e-6);
  const clusterOnce = (cellMM) => {
    const cs = Math.max(cellMM, maxSide / 150000);
    const K = Math.ceil(maxSide / cs) + 2;
    const map = new Map(); const P = []; const cnt = []; const F = [];
    const vid = (p) => {
      const k = (Math.floor((p[0]-mn[0])/cs) * K + Math.floor((p[1]-mn[1])/cs)) * K + Math.floor((p[2]-mn[2])/cs);
      let i = map.get(k);
      if (i === undefined) { i = P.length; map.set(k, i); P.push([0,0,0]); cnt.push(0); }
      P[i][0]+=p[0]; P[i][1]+=p[1]; P[i][2]+=p[2]; cnt[i]++; return i;
    };
    const seen = cellMM > 0 ? new Set() : null;
    for (const t of tris) {
      const a = vid(t[0]), b = vid(t[1]), c = vid(t[2]);
      if (a === b || b === c || a === c) continue;
      if (seen) { const o = [a, b, c].sort((x, y) => x - y); const s = o[0] + ',' + o[1] + ',' + o[2] + '|' + t[3]; if (seen.has(s)) continue; seen.add(s); }
      F.push([a, b, c, t[3]]);
    }
    for (let i = 0; i < P.length; i++) { P[i][0]/=cnt[i]; P[i][1]/=cnt[i]; P[i][2]/=cnt[i]; }
    return { P, F };
  };
  let res;
  if (nIn > maxTris) {
    // nº de triângulos ~ 1/célula²: estimar e afinar em poucas passagens
    let c = maxSide / 250; res = clusterOnce(c);
    for (let it = 0; it < 4 && Math.abs(res.F.length - maxTris) / maxTris > 0.1; it++) {
      c *= Math.sqrt(res.F.length / maxTris); res = clusterOnce(c);
    }
  } else res = clusterOnce(0);
  let { P, F } = res;
  const decimated = nIn > maxTris;

  // proteção
  // desvio aleatório dos vértices: invisível no ecrã, estraga encaixes e medidas exatas de uma cópia
  const J = P.map(() => [gauss(R) * jitterMM, gauss(R) * jitterMM, gauss(R) * jitterMM]);

  // mm Z-up -> m Y-up, centrado, no chão
  const toGL = (p) => [(p[0]-ctr[0]) * 0.001, (p[2]-mn[2]) * 0.001, -(p[1]-ctr[1]) * 0.001];
  const Q = P.map(toGL);
  const JQ = J ? J.map(j => [j[0]*0.001, j[2]*0.001, -j[1]*0.001]) : null;

  // normais por face + normais suaves com ângulo de quebra (35° para CAD, 60° para orgânico)
  const cosT = Math.cos((decimated ? 60 : 35) * Math.PI / 180);
  const fn = F.map(f => { const a = Q[f[0]], b = Q[f[1]], c = Q[f[2]]; const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]]; return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; });
  const fu = fn.map(n => { const l = Math.hypot(...n) || 1; return [n[0]/l, n[1]/l, n[2]/l]; });
  const adj = Array.from({ length: Q.length }, () => []);
  F.forEach((f, i) => { adj[f[0]].push(i); adj[f[1]].push(i); adj[f[2]].push(i); });

  // agrupar por cor
  const byKey = new Map();
  F.forEach((f, i) => { const k = String(f[3]); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); });
  const groups = [];
  for (const [k, faces] of byKey) {
    const pal = palette[k] || null;
    const cache = new Map(); const pos = [], nor = [], idx = [];
    for (const fi of faces) {
      for (let c = 0; c < 3; c++) {
        const vi = F[fi][c]; let n = [0, 0, 0];
        for (const fj of adj[vi]) { const d = fu[fj][0]*fu[fi][0] + fu[fj][1]*fu[fi][1] + fu[fj][2]*fu[fi][2]; if (d > cosT) { n[0]+=fn[fj][0]; n[1]+=fn[fj][1]; n[2]+=fn[fj][2]; } }
        const l = Math.hypot(...n) || 1; n = [n[0]/l, n[1]/l, n[2]/l];
        const key = vi + ':' + Math.round(n[0]*500) + ',' + Math.round(n[1]*500) + ',' + Math.round(n[2]*500);
        let id = cache.get(key);
        if (id === undefined) { id = pos.length / 3; cache.set(key, id); const q = Q[vi], j = JQ ? JQ[vi] : [0,0,0]; pos.push(q[0]+j[0], q[1]+j[1], q[2]+j[2]); nor.push(...n); }
        idx.push(id);
      }
    }
    groups.push({ hex: pal?.hex || null, silk: pal?.silk || false, pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx) });
  }
  // cores maiores primeiro (para o seletor)
  groups.sort((a, b) => b.idx.length - a.idx.length);
  const glb = buildGLB(groups);
  const colors = groups.filter(g => g.hex).map(g => g.hex.slice(0, 7).toUpperCase());
  return {
    glb, trisIn: nIn, trisOut: F.length, decimated,
    sizeMM: { largura: +size[0].toFixed(1), profundidade: +size[1].toFixed(1), altura: +size[2].toFixed(1) },
    colors: [...new Set(colors)], multicolor: new Set(colors).size > 1,
  };
}
