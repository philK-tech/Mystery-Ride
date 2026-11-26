// geometry.js: Geometrie-Builder und Upload auf die GPU
// --- Geometry Builder ---
// Vertex layout (12 floats per vertex):
// pos(3), normal(3), uv(2), extra(3: ao, glow/edge, sway/layer), matId(1)
function createGeometryBuilder() {
  return {
    positions: [],
    normals: [],
    uvs: [],
    extras: [],
    matIds: [],
    indices: [],
    pushVertex(px, py, pz, nx, ny, nz, u, v, e0 = 1.0, e1 = 0.0, e2 = 0.0, matId = 0) {
      this.positions.push(px, py, pz);
      this.normals.push(nx, ny, nz);
      this.uvs.push(u, v);
      this.extras.push(e0, e1, e2);
      this.matIds.push(matId);
    },
    pushTri(a, b, c) {
      this.indices.push(a, b, c);
    },
    pushQuad(a, b, c, d) {
      this.indices.push(a, b, c, a, c, d);
    },
    computeSmoothNormals() {
      const count = this.positions.length / 3;
      const acc = new Float32Array(count * 3);
      for (let i = 0; i < this.indices.length; i += 3) {
        const ia = this.indices[i], ib = this.indices[i + 1], ic = this.indices[i + 2];
        const ax = this.positions[ia * 3], ay = this.positions[ia * 3 + 1], az = this.positions[ia * 3 + 2];
        const bx = this.positions[ib * 3], by = this.positions[ib * 3 + 1], bz = this.positions[ib * 3 + 2];
        const cx = this.positions[ic * 3], cy = this.positions[ic * 3 + 1], cz = this.positions[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const idx of [ia, ib, ic]) {
          acc[idx * 3] += nx;
          acc[idx * 3 + 1] += ny;
          acc[idx * 3 + 2] += nz;
        }
      }
      for (let i = 0; i < count; i++) {
        let nx = acc[i * 3], ny = acc[i * 3 + 1], nz = acc[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz) || 1.0;
        this.normals[i * 3] = nx / len;
        this.normals[i * 3 + 1] = ny / len;
        this.normals[i * 3 + 2] = nz / len;
      }
    },
    computeFacetedNormals() {
      // Unrolls indexed triangles into crisp faceted triangles for craggy rock strata
      const newPos = [], newNorm = [], newUv = [], newExt = [], newMat = [], newIdx = [];
      for (let i = 0; i < this.indices.length; i += 3) {
        const ia = this.indices[i], ib = this.indices[i + 1], ic = this.indices[i + 2];
        const ax = this.positions[ia * 3], ay = this.positions[ia * 3 + 1], az = this.positions[ia * 3 + 2];
        const bx = this.positions[ib * 3], by = this.positions[ib * 3 + 1], bz = this.positions[ib * 3 + 2];
        const cx = this.positions[ic * 3], cy = this.positions[ic * 3 + 1], cz = this.positions[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1.0;
        nx /= len; ny /= len; nz /= len;
        for (const vIdx of [ia, ib, ic]) {
          const outIdx = newPos.length / 3;
          newPos.push(this.positions[vIdx * 3], this.positions[vIdx * 3 + 1], this.positions[vIdx * 3 + 2]);
          newNorm.push(nx, ny, nz);
          newUv.push(this.uvs[vIdx * 2], this.uvs[vIdx * 2 + 1]);
          newExt.push(this.extras[vIdx * 3], this.extras[vIdx * 3 + 1], this.extras[vIdx * 3 + 2]);
          newMat.push(this.matIds[vIdx]);
          newIdx.push(outIdx);
        }
      }
      this.positions = newPos;
      this.normals = newNorm;
      this.uvs = newUv;
      this.extras = newExt;
      this.matIds = newMat;
      this.indices = newIdx;
    }
  };
}

// Rotationskörper entlang einer Mittellinie: center(t) und radius(t) für t = 0..1
function addLathe(b, rings, secs, center, radius, matId, extra) {
  const base = b.positions.length / 3;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = center(t);
    const c2 = center(Math.min(t + 0.01, 1.0)), c1 = center(Math.max(t - 0.01, 0.0));
    let tx = c2[0] - c1[0], ty = c2[1] - c1[1], tz = c2[2] - c1[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // zwei Achsen senkrecht zur Mittellinie
    let ax = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = ty * ax[2] - tz * ax[1], uy = tz * ax[0] - tx * ax[2], uz = tx * ax[1] - ty * ax[0];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
    for (let j = 0; j <= secs; j++) {
      const a = (j / secs) * Math.PI * 2.0;
      const [rx, ry] = radius(t, a);
      const nx = ux * Math.cos(a) + vx * Math.sin(a);
      const ny = uy * Math.cos(a) + vy * Math.sin(a);
      const nz = uz * Math.cos(a) + vz * Math.sin(a);
      const r = Math.cos(a) * Math.cos(a) * rx + Math.sin(a) * Math.sin(a) * ry;
      const e = extra(t, a);
      b.pushVertex(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r, nx, ny, nz, j / secs, t, e[0], e[1], e[2], matId);
    }
  }
  const row = secs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < secs; j++) {
      const a = base + i * row + j;
      b.pushQuad(a, a + row, a + row + 1, a + 1);
    }
  }
}

function uploadStaticMesh(glCtx, builder) {
  const vertCount = builder.positions.length / 3;
  const interleaved = new Float32Array(vertCount * 12);
  for (let i = 0; i < vertCount; i++) {
    const o = i * 12;
    interleaved[o + 0] = builder.positions[i * 3 + 0];
    interleaved[o + 1] = builder.positions[i * 3 + 1];
    interleaved[o + 2] = builder.positions[i * 3 + 2];
    interleaved[o + 3] = builder.normals[i * 3 + 0];
    interleaved[o + 4] = builder.normals[i * 3 + 1];
    interleaved[o + 5] = builder.normals[i * 3 + 2];
    interleaved[o + 6] = builder.uvs[i * 2 + 0];
    interleaved[o + 7] = builder.uvs[i * 2 + 1];
    interleaved[o + 8] = builder.extras[i * 3 + 0];
    interleaved[o + 9] = builder.extras[i * 3 + 1];
    interleaved[o + 10] = builder.extras[i * 3 + 2];
    interleaved[o + 11] = builder.matIds[i];
  }

  const vao = glCtx.createVertexArray();
  glCtx.bindVertexArray(vao);

  const vbo = glCtx.createBuffer();
  glCtx.bindBuffer(glCtx.ARRAY_BUFFER, vbo);
  glCtx.bufferData(glCtx.ARRAY_BUFFER, interleaved, glCtx.STATIC_DRAW);

  const stride = 12 * 4;
  glCtx.enableVertexAttribArray(0);
  glCtx.vertexAttribPointer(0, 3, glCtx.FLOAT, false, stride, 0);
  glCtx.enableVertexAttribArray(1);
  glCtx.vertexAttribPointer(1, 3, glCtx.FLOAT, false, stride, 12);
  glCtx.enableVertexAttribArray(2);
  glCtx.vertexAttribPointer(2, 2, glCtx.FLOAT, false, stride, 24);
  glCtx.enableVertexAttribArray(3);
  glCtx.vertexAttribPointer(3, 3, glCtx.FLOAT, false, stride, 32);
  glCtx.enableVertexAttribArray(4);
  glCtx.vertexAttribPointer(4, 1, glCtx.FLOAT, false, stride, 44);

  const ibo = glCtx.createBuffer();
  glCtx.bindBuffer(glCtx.ELEMENT_ARRAY_BUFFER, ibo);
  glCtx.bufferData(glCtx.ELEMENT_ARRAY_BUFFER, new Uint32Array(builder.indices), glCtx.STATIC_DRAW);

  glCtx.bindVertexArray(null);
  return { vao, indexCount: builder.indices.length };
}

// Instance buffer layout per instance:
// mat4 (16 floats) + tint vec4 (4 floats) = 20 floats
// Die Instanzen werden nach z sortiert. So lässt sich beim Zeichnen nur der Abschnitt der Strecke
// auswählen, den die Kamera gerade sehen kann (siehe drawInstancedRange).
function uploadInstancedMesh(glCtx, builder, matsArray, tintsArray, margin = 6.0) {
  const base = uploadStaticMesh(glCtx, builder);
  const count = tintsArray.length / 4;
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => matsArray[b * 16 + 14] - matsArray[a * 16 + 14]);
  const instData = new Float32Array(count * 20);
  const zs = new Float32Array(count);
  order.forEach((src, i) => {
    instData.set(matsArray.subarray(src * 16, src * 16 + 16), i * 20);
    instData.set(tintsArray.subarray(src * 4, src * 4 + 4), i * 20 + 16);
    zs[i] = matsArray[src * 16 + 14];
  });

  glCtx.bindVertexArray(base.vao);
  const instBuf = glCtx.createBuffer();
  glCtx.bindBuffer(glCtx.ARRAY_BUFFER, instBuf);
  glCtx.bufferData(glCtx.ARRAY_BUFFER, instData, glCtx.STATIC_DRAW);
  for (let loc = 5; loc <= 9; loc++) {
    glCtx.enableVertexAttribArray(loc);
    glCtx.vertexAttribDivisor(loc, 1);
  }
  glCtx.bindVertexArray(null);
  return { vao: base.vao, indexCount: base.indexCount, instanceCount: count, instBuf, zs, margin };
}

// zs ist absteigend sortiert (0 ... -LOOP_LENGTH): erster Index mit zs[i] <= z
function lowerIndex(zs, z) {
  let lo = 0, hi = zs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (zs[mid] > z) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Zeichnet nur die Instanzen mit zMin <= z <= zMax
function drawInstancedRange(glCtx, grp, zMin, zMax) {
  const first = lowerIndex(grp.zs, zMax + grp.margin);
  const last = lowerIndex(grp.zs, zMin - grp.margin);
  const n = last - first;
  if (n <= 0) return;
  glCtx.bindVertexArray(grp.vao);
  glCtx.bindBuffer(glCtx.ARRAY_BUFFER, grp.instBuf);
  const stride = 80, base = first * stride;
  for (let col = 0; col < 4; col++) glCtx.vertexAttribPointer(5 + col, 4, glCtx.FLOAT, false, stride, base + col * 16);
  glCtx.vertexAttribPointer(9, 4, glCtx.FLOAT, false, stride, base + 64);
  glCtx.drawElementsInstanced(glCtx.TRIANGLES, grp.indexCount, glCtx.UNSIGNED_INT, 0, n);
}
