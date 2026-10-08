// Simplificação por métrica de erro quadrático (Garland & Heckbert), como o "Decimate" do Blender.
// Tira triângulos primeiro onde a superfície é plana; mantém curvas, pormenores, arestas abertas e fronteiras entre cores.
// P: [[x,y,z]...]  F: [[a,b,c,cor]...]  ->  { P, F } com ~alvo triângulos
export function simplificarQEM(P, F, alvo, onProgress) {
  const nv = P.length, nf = F.length;
  if (nf <= alvo) return { P, F };
  const V = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) { V[3 * i] = P[i][0]; V[3 * i + 1] = P[i][1]; V[3 * i + 2] = P[i][2]; }
  const T = new Int32Array(nf * 3), cor = new Array(nf), vivaF = new Uint8Array(nf).fill(1);
  for (let f = 0; f < nf; f++) { T[3 * f] = F[f][0]; T[3 * f + 1] = F[f][1]; T[3 * f + 2] = F[f][2]; cor[f] = F[f][3]; }
  const Q = new Float64Array(nv * 10), vivaV = new Uint8Array(nv).fill(1), versao = new Int32Array(nv);

  // vértice -> faces (listas compactas, com espaço para crescer)
  let vf = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vf[T[3 * f + k]].push(f);

  const addPlane = (qi, a, b, c, d, w) => {
    const o = qi * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
  };
  const normal = (f, out) => {
    const a = T[3 * f] * 3, b = T[3 * f + 1] * 3, c = T[3 * f + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx;
    const l = Math.hypot(out[0], out[1], out[2]); return l;
  };
  const n3 = [0, 0, 0];
  for (let f = 0; f < nf; f++) {
    const l = normal(f, n3); if (l < 1e-14) continue;
    const nx = n3[0] / l, ny = n3[1] / l, nz = n3[2] / l, a = T[3 * f] * 3;
    const d = -(nx * V[a] + ny * V[a + 1] + nz * V[a + 2]), w = l / 2; // peso = área
    for (let k = 0; k < 3; k++) addPlane(T[3 * f + k], nx, ny, nz, d, w);
  }
  // arestas: abertas ou entre cores diferentes recebem planos "travão" perpendiculares
  const edgeFaces = new Map(), key = (a, b) => a < b ? a * nv + b : b * nv + a;
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
    const a = T[3 * f + k], b = T[3 * f + (k + 1) % 3], kk = key(a, b);
    const e = edgeFaces.get(kk); if (e) e.push(f); else edgeFaces.set(kk, [f]);
  }
  for (const [kk, fs] of edgeFaces) {
    const fronteira = fs.length === 1 || fs.some(f => cor[f] !== cor[fs[0]]);
    if (!fronteira) continue;
    const a = Math.floor(kk / nv), b = kk % nv;
    const ex = V[3 * b] - V[3 * a], ey = V[3 * b + 1] - V[3 * a + 1], ez = V[3 * b + 2] - V[3 * a + 2], el = Math.hypot(ex, ey, ez); if (el < 1e-12) continue;
    for (const f of fs) {
      const l = normal(f, n3); if (l < 1e-14) continue;
      let px = ey * n3[2] - ez * n3[1], py = ez * n3[0] - ex * n3[2], pz = ex * n3[1] - ey * n3[0]; const pl = Math.hypot(px, py, pz); if (pl < 1e-14) continue;
      px /= pl; py /= pl; pz /= pl;
      const d = -(px * V[3 * a] + py * V[3 * a + 1] + pz * V[3 * a + 2]), w = 1000 * el * el;
      addPlane(a, px, py, pz, d, w); addPlane(b, px, py, pz, d, w);
    }
  }

  // custo e posição ótima de uma aresta
  const qsum = new Float64Array(10), best = new Float64Array(3);
  const errAt = (q, x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const custo = (a, b) => {
    for (let i = 0; i < 10; i++) qsum[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const q = qsum;
    // resolver [q0 q1 q2; q1 q4 q5; q2 q5 q7] x = -[q3 q6 q8]
    const A = q[0], B = q[1], C = q[2], D = q[4], E = q[5], Fq = q[7];
    const det = A * (D * Fq - E * E) - B * (B * Fq - E * C) + C * (B * E - D * C);
    const ax = V[3 * a], ay = V[3 * a + 1], az = V[3 * a + 2], bx = V[3 * b], by = V[3 * b + 1], bz = V[3 * b + 2];
    const scale = Math.max(Math.abs(A), Math.abs(D), Math.abs(Fq), 1e-30);
    if (Math.abs(det) > 1e-10 * scale * scale * scale) {
      const r0 = -q[3], r1 = -q[6], r2 = -q[8];
      const x = (r0 * (D * Fq - E * E) - B * (r1 * Fq - E * r2) + C * (r1 * E - D * r2)) / det;
      const y = (A * (r1 * Fq - E * r2) - r0 * (B * Fq - E * C) + C * (B * r2 - r1 * C)) / det;
      const z = (A * (D * r2 - r1 * E) - B * (B * r2 - r1 * C) + r0 * (B * E - D * C)) / det;
      // não deixar o ponto fugir para longe da aresta
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2, el = Math.hypot(bx - ax, by - ay, bz - az);
      if (Math.hypot(x - mx, y - my, z - mz) <= el * 2) { best[0] = x; best[1] = y; best[2] = z; return errAt(q, x, y, z); }
    }
    let bc = Infinity;
    for (const t of [0, 0.5, 1]) {
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, e = errAt(q, x, y, z);
      if (e < bc) { bc = e; best[0] = x; best[1] = y; best[2] = z; }
    }
    return bc;
  };

  // fila de prioridade (heap binário) com entradas preguiçosas
  let hc = new Float64Array(1 << 20), ha = new Int32Array(1 << 20), hb = new Int32Array(1 << 20), hva = new Int32Array(1 << 20), hvb = new Int32Array(1 << 20), hn = 0;
  const grow = () => { const n = hc.length * 2; const g = (o, C) => { const x = new C(n); x.set(o); return x; }; hc = g(hc, Float64Array); ha = g(ha, Int32Array); hb = g(hb, Int32Array); hva = g(hva, Int32Array); hvb = g(hvb, Int32Array); };
  const swap = (i, j) => { let t = hc[i]; hc[i] = hc[j]; hc[j] = t; t = ha[i]; ha[i] = ha[j]; ha[j] = t; t = hb[i]; hb[i] = hb[j]; hb[j] = t; t = hva[i]; hva[i] = hva[j]; hva[j] = t; t = hvb[i]; hvb[i] = hvb[j]; hvb[j] = t; };
  const push = (c, a, b) => {
    if (hn >= hc.length) grow();
    let i = hn++; hc[i] = c; ha[i] = a; hb[i] = b; hva[i] = versao[a]; hvb[i] = versao[b];
    while (i > 0) { const p = (i - 1) >> 1; if (hc[p] <= hc[i]) break; swap(i, p); i = p; }
  };
  const pop = () => {
    hn--; swap(0, hn); let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && hc[l] < hc[m]) m = l; if (r < hn && hc[r] < hc[m]) m = r; if (m === i) break; swap(i, m); i = m; }
    return hn;
  };
  for (const kk of edgeFaces.keys()) { const a = Math.floor(kk / nv), b = kk % nv; push(custo(a, b), a, b); }
  edgeFaces.clear();

  // colapsar
  let vivas = nf; const total = nf - alvo; let feitos = 0, ultimoAviso = 0;
  const marca = new Int32Array(nv), marca2 = new Int32Array(nv); let gen = 0;
  const nOld = [0, 0, 0], nNew = [0, 0, 0];
  while (vivas > alvo && hn > 0) {
    pop(); const i = hn, a = ha[i], b = hb[i];
    if (!vivaV[a] || !vivaV[b] || hva[i] !== versao[a] || hvb[i] !== versao[b]) continue;
    custo(a, b); const px = best[0], py = best[1], pz = best[2];
    // condição de ligação (evita malha não-manifold): vizinhos comuns = faces partilhadas
    gen++;
    let partilhadas = 0;
    for (const f of vf[a]) if (vivaF[f]) for (let k = 0; k < 3; k++) marca[T[3 * f + k]] = gen;
    for (const f of vf[b]) if (vivaF[f]) { let tem = false; for (let k = 0; k < 3; k++) if (T[3 * f + k] === a) tem = true; if (tem) partilhadas++; }
    let comuns = 0;
    for (const f of vf[b]) if (vivaF[f]) for (let k = 0; k < 3; k++) { const v = T[3 * f + k]; if (v !== a && v !== b && marca[v] === gen && marca2[v] !== gen) { marca2[v] = gen; comuns++; } }
    if (comuns > partilhadas) continue;
    // não deixar faces virar ao contrário
    let invalido = false;
    for (const v of [a, b]) {
      for (const f of vf[v]) {
        if (!vivaF[f]) continue;
        let temA = false, temB = false; for (let k = 0; k < 3; k++) { if (T[3 * f + k] === a) temA = true; if (T[3 * f + k] === b) temB = true; }
        if (temA && temB) continue;
        const lo = normal(f, nOld);
        const sx = V[3 * v], sy = V[3 * v + 1], sz = V[3 * v + 2];
        V[3 * v] = px; V[3 * v + 1] = py; V[3 * v + 2] = pz;
        const ln = normal(f, nNew);
        V[3 * v] = sx; V[3 * v + 1] = sy; V[3 * v + 2] = sz;
        if (ln < 1e-14 || (nOld[0] * nNew[0] + nOld[1] * nNew[1] + nOld[2] * nNew[2]) < 0.25 * lo * ln) { invalido = true; break; }
      }
      if (invalido) break;
    }
    if (invalido) continue;
    // aplicar: b funde-se em a
    V[3 * a] = px; V[3 * a + 1] = py; V[3 * a + 2] = pz;
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    for (const f of vf[b]) {
      if (!vivaF[f]) continue;
      let temA = false; for (let k = 0; k < 3; k++) if (T[3 * f + k] === a) temA = true;
      if (temA) { vivaF[f] = 0; vivas--; continue; }
      for (let k = 0; k < 3; k++) if (T[3 * f + k] === b) T[3 * f + k] = a;
      vf[a].push(f);
    }
    vivaV[b] = 0; vf[b] = null; versao[a]++;
    vf[a] = vf[a].filter(f => vivaF[f]);
    // novas arestas à volta de a (as antigas ficam inválidas porque a versão de a mudou)
    gen++;
    for (const f of vf[a]) for (let k = 0; k < 3; k++) { const v = T[3 * f + k]; if (v !== a && marca[v] !== gen) { marca[v] = gen; push(custo(a, v), a, v); } }
    feitos = nf - vivas;
    if (onProgress && feitos - ultimoAviso > 50000) { ultimoAviso = feitos; onProgress(feitos / total); }
  }

  // compactar
  const novo = new Int32Array(nv).fill(-1), P2 = [], F2 = [];
  for (let f = 0; f < nf; f++) {
    if (!vivaF[f]) continue;
    const t = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const v = T[3 * f + k]; if (novo[v] < 0) { novo[v] = P2.length; P2.push([V[3 * v], V[3 * v + 1], V[3 * v + 2]]); } t[k] = novo[v]; }
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) F2.push([t[0], t[1], t[2], cor[f]]);
  }
  return { P: P2, F: F2 };
}
