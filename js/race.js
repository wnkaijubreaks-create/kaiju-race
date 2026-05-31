/* Race engine: lane layout for small fields, pack layout for big ones,
   random-walk movement, finish detection, cached-sprite drawing.
   Background is a destroyed-city scene baked to an offscreen canvas. */
const LANE_MAX = 24;

function cityRng(seed) {
  let a = (seed * 0x9e3779b9) >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smoothly interpolate a racer's scripted progress timeline [[f,p],...] at time f.
function interpKF(kf, f) {
  if (f <= kf[0][0]) return kf[0][1];
  for (let i = 1; i < kf.length; i++) {
    if (f <= kf[i][0]) {
      const [f0, p0] = kf[i - 1], [f1, p1] = kf[i];
      let t = (f - f0) / (f1 - f0);
      t = t * t * (3 - 2 * t); // smoothstep
      return p0 + (p1 - p0) * t;
    }
  }
  return kf[kf.length - 1][1];
}

class KaijuRace {
  constructor(canvas, onFinish) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onFinish = onFinish || (() => {});
    this.cfg = { count: 8, showNumbers: true, useArt: true, chaos: 55, duration: 30 };
    this.racers = [];
    this.exclude = new Set();
    this.state = "idle";
    this.elapsed = 0;
    this.camLo = 0;
    this.breakF = 0.8; this.camF = 0.85; this.packEnd = 0.5; this.leadCount = 0;
    this._last = 0;
    this._raf = null;
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  configure(partial) { Object.assign(this.cfg, partial); }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
    this._buildCity();
    if (this.state !== "running") this.draw();
  }

  reset() {
    const all = [];
    for (let i = 1; i <= this.cfg.count; i++) if (!this.exclude.has(i)) all.push(i);
    const total = all.length || this.cfg.count;
    this.racers = all.map((number) => ({
      number,
      sprite: KaijuArt.makeSprite({
        color: KaijuArt.palette(number - 1, this.cfg.count),
        seed: number * 9301 + 49297,
        index: number - 1,
        number,
        showNumber: this.cfg.showNumbers,
        useArt: this.cfg.useArt,
      }),
      packY: 0.07 + Math.random() * 0.86,
      prog: 0,
      phase: Math.random() * Math.PI * 2,
    }));
    this.lane = total <= LANE_MAX;
    this.racers.forEach((r, i) => (r.laneIdx = i));
    this.total = total;

    this._assignPaces();
    this.elapsed = 0;
    this.state = "idle";
    this.winner = null;
    this.draw();
  }

  // Staged race narrative via per-racer keyframe timelines:
  //   start→~30%  whole pack bunched & jostling
  //   ~30-45%     the back ~60% fall off early (camera culls them)
  //   ~72%        an early lead group looks like the winners
  //   ~88%        the final group surges up from behind
  //   final push  a tight group of 3-4 battles to the line, winner just edges it
  _assignPaces() {
    const chaos = this.cfg.chaos / 100;
    const D = this.cfg.duration;
    const N = this.racers.length;
    this.breakF = 0.62; // when the finish line starts to reveal

    const J = (v, a) => v + (Math.random() * 2 - 1) * a;
    const idx = this.racers.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }

    // Keep ~22 (≥20) racers in contention to the finish; the rest FALL OFF —
    // they drift back and fade away over the race (gentle, not a hard cull).
    const keep = Math.min(N, 22);
    const frontIdx = idx.slice(0, keep);
    const fallIdx = idx.slice(keep);
    const fallSet = new Set(fallIdx);

    // Spread finishing distances: the kept pack fans across the track (0.5-0.95),
    // the fall-off group ends well back (and fades out — see draw()).
    frontIdx.forEach((ri, pos) => {
      const frac = keep <= 1 ? 0 : pos / (keep - 1);
      this.racers[ri]._fd = Math.max(0.5, Math.min(0.95, J(0.95 - frac * 0.45, 0.03)));
    });
    fallIdx.forEach((ri, pos) => {
      const frac = fallIdx.length <= 1 ? 0 : pos / (fallIdx.length - 1);
      this.racers[ri]._fd = Math.max(0.1, Math.min(0.46, J(0.45 - frac * 0.33, 0.04)));
    });

    // ~25% of races: a dark horse from the back of the visible pack storms up to win.
    const darkHorse = Math.random() < 0.25 && keep >= 5;
    const winnerIdx = darkHorse ? frontIdx[keep - 1]                          // back of the pack
      : frontIdx[Math.floor(Math.random() * Math.min(keep, 7))];               // a front contender (varies)

    this.racers.forEach((r, i) => {
      r.amp = 0.04 + chaos * 0.12 * Math.random();
      r.w = ((2 * Math.PI) / D) * (3 + Math.random() * 4);
      r.w2 = ((2 * Math.PI) / D) * (1.5 + Math.random() * 2.5);
      r.phase2 = Math.random() * Math.PI * 2;
      r.phase3 = Math.random() * Math.PI * 2;
      r._fallOff = fallSet.has(i);
      if (i === winnerIdx && darkHorse) {
        // lurks at the back of the pack, then surges up to win
        r.kf = [[0, 0], [0.5, J(0.42, 0.04)], [0.78, J(0.6, 0.04)], [0.93, J(0.92, 0.03)], [1, 1]];
      } else if (i === winnerIdx) {
        // bunched, then pulls to the line
        r.kf = [[0, 0], [0.4, J(0.42, 0.04)], [0.72, 0.72], [1, 1]];
      } else {
        // bunched early, then strings out to its finishing spot
        const fd = r._fd;
        r.kf = [[0, 0], [0.4, J(0.40, 0.05)], [0.72, 0.40 + (fd - 0.40) * 0.55], [1, fd]];
      }
    });
    this.winnerRacer = this.racers[winnerIdx];
    this.camLo = 0;
  }

  // Rearrange the kaiju: new lane order, new pack positions, fresh random winner.
  shuffle() {
    if (this.state === "running" || this.racers.length === 0) return;
    const order = this.racers.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.racers.forEach((r, i) => { r.laneIdx = order[i]; r.packY = 0.07 + Math.random() * 0.86; });
    this._assignPaces();
    this.elapsed = 0;
    this.state = "idle";
    this.winner = null;
    this.draw();
  }

  start() {
    if (this.state === "running") return;
    if (this.state === "finished" || this.racers.length === 0) this.reset();
    this.state = "running";
    this._last = performance.now();
    const tick = (t) => {
      if (this.state !== "running") return;
      const dt = Math.min((t - this._last) / 1000, 0.05);
      this._last = t;
      this._update(dt);
      this.draw();
      if (this.state === "running") this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  pause() { if (this.state === "running") { this.state = "paused"; cancelAnimationFrame(this._raf); } }
  resume() { if (this.state === "paused") this.start(); }
  clear() { cancelAnimationFrame(this._raf); this.reset(); }

  _update(dt) {
    this.elapsed += dt;
    const D = this.cfg.duration;
    const f = Math.min(this.elapsed / D, 1);
    // Jostle: strong while bunched early, faded out by ~90% so the staged groups
    // (and the close photo finish) stay distinct.
    const up = Math.min(1, f / 0.1);
    const down = Math.max(0, Math.min(1, (0.9 - f) / 0.45));
    const env = up * down;
    const t = this.elapsed;
    for (const r of this.racers) {
      const base = interpKF(r.kf, f);              // scripted stage position
      const surge = r.amp * (Math.sin(r.w * t + r.phase2) + 0.6 * Math.sin(r.w2 * t + r.phase3));
      let p = base + surge * env;
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      r.prog = p;
    }
    this._updateCamera(f);
    if (this.elapsed >= D && !this.winner && this.winnerRacer) {
      this.elapsed = D;
      for (const r of this.racers) r.prog = interpKF(r.kf, 1);
      this.winnerRacer.prog = 1;
      this._updateCamera(1, true);
      this.winner = this.winnerRacer.number;
      this.state = "finished";
      cancelAnimationFrame(this._raf);
      setTimeout(() => this.onFinish(this.winner), 350);
    }
  }

  // No camera zoom — the whole field stays on screen the entire race; the pack
  // strings out along the track and stragglers gently fade (see draw()).
  _updateCamera() {
    this.camLo = 0;
  }

  _layout() {
    const mobile = this.W < 620;
    // Smaller city band on phones → more vertical room for (bigger) racers.
    const horizon = mobile
      ? Math.min(150, Math.round(this.H * 0.2))
      : Math.min(230, Math.round(this.H * 0.3));
    const bottom = 18;
    const left = mobile ? 30 : 50;
    const finishX = this.W - (mobile ? 64 : 110);
    return { horizon, bottom, left, finishX, trackW: finishX - left };
  }

  // Bake the destroyed-city scene as separate horizontally-tileable layers
  // (sky stays static; far/near skylines and the ground scroll at different
  // speeds for a parallax "stomping through the city" feel). The finish line
  // is baked on its own and stays fixed.
  _buildCity() {
    const { W, H } = this;
    const L = this._layout();
    const hz = L.horizon;
    const gh = H - hz;
    this.smokeX = [];
    const mk = (w, h) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return cv; };

    // --- Static sky + sun ---
    const sky = mk(W, hz), sc = sky.getContext("2d");
    const g = sc.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, "#1e1830"); g.addColorStop(0.55, "#4a2c49"); g.addColorStop(1, "#9c5234");
    sc.fillStyle = g; sc.fillRect(0, 0, W, hz);
    const sun = sc.createRadialGradient(W * 0.72, hz * 0.35, 4, W * 0.72, hz * 0.35, hz);
    sun.addColorStop(0, "rgba(255,190,110,0.55)"); sun.addColorStop(1, "rgba(255,190,110,0)");
    sc.fillStyle = sun; sc.fillRect(0, 0, W, hz);
    this.skyCanvas = sky;

    // --- Tileable skyline layer: building widths sum exactly to W so the strip
    //     loops seamlessly when drawn twice side by side. ---
    const maxTop = hz - 86;
    const buildSkyline = (rng, color, minH, maxH, windows) => {
      const cv = mk(W, hz), c = cv.getContext("2d");
      const n = Math.max(4, Math.round(W / 48));
      const ws = []; let sum = 0;
      for (let i = 0; i < n; i++) { const w = 38 + rng() * 54; ws.push(w); sum += w; }
      const scale = W / sum;
      let x = 0;
      for (let bi = 0; bi < n; bi++) {
        const w = ws[bi] * scale;
        const top = hz - (minH + rng() * (maxH - minH));
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(x, hz); c.lineTo(x, top + rng() * 14);
        const segs = 2 + Math.floor(rng() * 4);
        for (let i = 1; i <= segs; i++) {
          const sx = x + (w * i) / segs;
          const dip = rng() < 0.3 ? rng() * 34 : rng() * 10;
          c.lineTo(sx, top + dip);
        }
        c.lineTo(x + w, hz); c.closePath(); c.fill();
        if (windows) {
          for (let wy = top + 22; wy < hz - 6; wy += 14)
            for (let wx = x + 7; wx < x + w - 6; wx += 12) {
              if (rng() < 0.22) continue;
              c.fillStyle = rng() < 0.14 ? "#ffb347" : "#15121c";
              c.fillRect(wx, wy, 5, 7);
            }
          if (rng() < 0.5) this.smokeX.push({ x: x + w * 0.5, base: top + 6 });
        }
        x += w;
      }
      return cv;
    };
    this.farCanvas = buildSkyline(cityRng(7), "#3a2c52", Math.min(55, maxTop), Math.min(110, maxTop), false);
    this.nearCanvas = buildSkyline(cityRng(31), "#241a36", Math.min(80, maxTop), maxTop, true);

    // --- Tileable ground (uniform vertical gradient + scattered cracks/rubble) ---
    const gr = mk(W, gh), gc = gr.getContext("2d");
    const grd = gc.createLinearGradient(0, 0, 0, gh);
    grd.addColorStop(0, "#211f27"); grd.addColorStop(1, "#3b3a44");
    gc.fillStyle = grd; gc.fillRect(0, 0, W, gh);
    const rng = cityRng(99);
    gc.strokeStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < 6; i++) {
      let cx = rng() * W, cy = rng() * gh;
      gc.lineWidth = 1 + rng() * 2;
      gc.beginPath(); gc.moveTo(cx, cy);
      for (let s = 0; s < 5; s++) { cx += (rng() - 0.5) * 80; cy += rng() * 40; gc.lineTo(cx, cy); }
      gc.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const rx = rng() * W;
      const ry = 6 + rng() * (gh - 6);
      const sz = 4 + rng() * 12 * ry / gh;
      gc.fillStyle = rng() < 0.5 ? "#2c2a33" : "#4a4853";
      gc.beginPath();
      gc.moveTo(rx, ry - sz); gc.lineTo(rx + sz, ry); gc.lineTo(rx - sz * 0.4, ry + sz * 0.5);
      gc.closePath(); gc.fill();
    }
    this.groundCanvas = gr;

    // --- Fixed finish line (checkered band) ---
    const sq = 18, fw = sq * 2;
    const fc = mk(fw, gh), fcx = fc.getContext("2d");
    for (let y = 0, row = 0; y < gh; y += sq, row++)
      for (let k = 0; k < 2; k++) {
        fcx.fillStyle = (row + k) % 2 ? "#fff" : "#16181f";
        fcx.fillRect(k * sq, y, sq, sq);
      }
    this.finishCanvas = fc;
  }

  _drawBackground() {
    const ctx = this.ctx, { W, H } = this;
    const L = this._layout(), hz = L.horizon;
    const e = this.elapsed; // frozen when idle/finished, advances while running

    ctx.drawImage(this.skyCanvas, 0, 0);

    // Draw a tileable layer twice so it wraps seamlessly as it scrolls left.
    const tile = (cv, speed, y) => {
      let off = (e * speed) % W; if (off < 0) off += W;
      ctx.drawImage(cv, -off, y);
      ctx.drawImage(cv, -off + W, y);
    };
    tile(this.farCanvas, 16, 0);    // distant skyline — slow
    tile(this.nearCanvas, 42, 0);   // near skyline — medium

    // Horizon haze (static gradient overlay)
    const haze = ctx.createLinearGradient(0, hz - 40, 0, hz + 30);
    haze.addColorStop(0, "rgba(200,130,80,0)");
    haze.addColorStop(0.5, "rgba(200,130,80,0.35)");
    haze.addColorStop(1, "rgba(200,130,80,0)");
    ctx.fillStyle = haze; ctx.fillRect(0, hz - 40, W, 70);

    tile(this.groundCanvas, 105, hz); // foreground street — fast

    // Smoke plumes scroll with the near skyline.
    if (this.smokeX) {
      let noff = (e * 42) % W; if (noff < 0) noff += W;
      for (const p of this.smokeX) {
        for (const xc of [p.x - noff, p.x - noff + W]) {
          if (xc < -30 || xc > W + 30) continue;
          for (let i = 0; i < 6; i++) {
            const t = (e * 0.25 + i * 0.5) % 3;
            const yy = p.base - t * 22;
            const r = 6 + t * 7;
            const sway = Math.sin(e * 0.5 + i + p.x) * 6;
            ctx.fillStyle = `rgba(70,66,72,${0.28 * (1 - t / 3)})`;
            ctx.beginPath(); ctx.ellipse(xc + sway, yy, r, r, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }

    // Finish line — hidden through most of the race, then slides + fades in
    // toward the end (reaches its fixed spot before the winner arrives).
    if (this.finishCanvas) {
      const f = e / Math.max(1e-3, this.cfg.duration);
      const fr = Math.max(0, Math.min(1, (f - this.breakF) / Math.max(1e-3, (1 - this.breakF) * 0.6)));
      if (fr > 0) {
        ctx.save();
        ctx.globalAlpha = fr;
        ctx.drawImage(this.finishCanvas, L.finishX + (1 - fr) * 90, hz);
        ctx.restore();
      }
    }
  }

  draw() {
    const ctx = this.ctx, { H } = this;
    const L = this._layout();
    this._drawBackground();

    const n = this.racers.length;
    const bandTop = L.horizon + 6, bandH = H - L.horizon - L.bottom - 12;
    // `h` is the on-screen sprite-canvas height; the creature fills ~90% of it.
    let h;
    const mobile = this.W < 620;
    const wCap = this.W * (mobile ? 0.62 : 0.42); // allow bigger sprites on phones
    if (this.lane) h = Math.min((bandH / Math.max(n, 1)) * (mobile ? 1.9 : 1.45), 300, wCap);
    else h = Math.min(Math.max(38, Math.min(160, (mobile ? 820 : 980) / Math.sqrt(n))), wCap);

    const order = this.lane
      ? [...this.racers].sort((a, b) => a.laneIdx - b.laneIdx)
      : [...this.racers].sort((a, b) => a.prog - b.prog);

    const camLo = this.camLo || 0;
    const span = Math.max(1e-3, 1 - camLo);
    const lead = this.racers.reduce((m, r) => Math.max(m, r.prog), 0);

    for (const r of order) {
      const cv = r.sprite;
      const dh = h, dw = dh * (cv.width / cv.height);
      const cx = L.left + ((r.prog - camLo) / span) * L.trackW;
      let cy;
      if (this.lane) cy = bandTop + (bandH / n) * (r.laneIdx + 0.5) + Math.sin(this.elapsed * 4 + r.phase) * 3;
      else cy = bandTop + bandH * r.packY + Math.sin(this.elapsed * 4 + r.phase) * 2;
      if (cx < -dw) continue;
      // The fall-off group fades fully away as it drops back; the kept pack stays
      // visible (only a gentle dim toward the tail).
      const gap = lead - r.prog;
      const a = r._fallOff
        ? Math.max(0, Math.min(1, 1 - (gap - 0.12) / 0.3))   // fades out → "falls off"
        : Math.max(0.55, Math.min(1, 1 - (gap - 0.35) / 0.5)); // stays in view
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(cv, cx - dw / 2, cy - dh / 2, dw, dh);
    }
    ctx.globalAlpha = 1;
  }
}
