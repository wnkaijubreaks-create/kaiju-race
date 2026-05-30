/* Kaiju rendering: procedural chibi monsters with costumes + optional image sprites.
   Each kaiju is baked once to an offscreen canvas (makeSprite) then blitted each
   frame, so even 150 racers animate cheaply. */
const KaijuArt = (() => {
  // mulberry32 — good decorrelation even for sequential seeds.
  function seeded(seed) {
    let a = (seed * 0x9e3779b9) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function palette(i, total) {
    const hue = Math.round((360 / Math.max(total, 1)) * i + i * 47) % 360;
    return {
      body: `hsl(${hue}, 62%, 52%)`,
      dark: `hsl(${hue}, 60%, 34%)`,
      belly: `hsl(${hue}, 55%, 78%)`,
      spike: `hsl(${(hue + 35) % 360}, 70%, 60%)`,
      accent: `hsl(${(hue + 180) % 360}, 70%, 55%)`,
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function star(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a2) * r * 0.45, y + Math.sin(a2) * r * 0.45);
    }
    ctx.closePath();
  }

  function heart(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.3);
    ctx.bezierCurveTo(x + r, y - r * 0.6, x + r * 1.1, y + r * 0.5, x, y + r);
    ctx.bezierCurveTo(x - r * 1.1, y + r * 0.5, x - r, y - r * 0.6, x, y + r * 0.3);
    ctx.closePath();
  }

  // ---- Body patterns, drawn clipped to the body ellipse ----
  function drawPattern(ctx, s, type, color) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0.05 * s, 0.35 * s, 0.31 * s, 0, 0, Math.PI * 2);
    ctx.clip();
    if (type === "stripes") {
      ctx.strokeStyle = color.dark; ctx.lineWidth = 0.05 * s;
      for (let x = -0.5 * s; x < 0.6 * s; x += 0.12 * s) {
        ctx.beginPath(); ctx.moveTo(x, -0.4 * s); ctx.lineTo(x + 0.4 * s, 0.5 * s); ctx.stroke();
      }
    } else if (type === "stars") {
      ctx.fillStyle = "#fff5cc";
      for (let gx = -0.3; gx <= 0.3; gx += 0.18)
        for (let gy = -0.12; gy <= 0.28; gy += 0.16) {
          star(ctx, gx * s, gy * s, 0.05 * s); ctx.fill();
        }
    } else if (type === "hearts") {
      ctx.fillStyle = "#ffd1e8";
      for (let gx = -0.3; gx <= 0.3; gx += 0.18)
        for (let gy = -0.1; gy <= 0.3; gy += 0.16) {
          heart(ctx, gx * s, gy * s, 0.045 * s); ctx.fill();
        }
    } else if (type === "spots") {
      ctx.fillStyle = color.dark;
      for (let gx = -0.3; gx <= 0.3; gx += 0.17)
        for (let gy = -0.1; gy <= 0.3; gy += 0.15) {
          ctx.beginPath(); ctx.ellipse(gx * s, gy * s, 0.045 * s, 0.045 * s, 0, 0, 7); ctx.fill();
        }
    }
    ctx.restore();
  }

  // ---- Hats, placed on top of the head (head center ~0.30s,-0.18s, r~0.22s) ----
  function drawHat(ctx, s, type, color) {
    const hx = 0.30 * s, top = -0.39 * s, out = Math.max(2, s * 0.022);
    ctx.lineWidth = out; ctx.strokeStyle = "#16181f"; ctx.lineJoin = "round";
    const stroke = (col) => { ctx.fillStyle = col; ctx.fill(); ctx.stroke(); };
    if (type === "party") {
      ctx.beginPath();
      ctx.moveTo(hx - 0.13 * s, top + 0.04 * s);
      ctx.lineTo(hx + 0.13 * s, top + 0.04 * s);
      ctx.lineTo(hx, top - 0.20 * s); ctx.closePath();
      stroke(color.accent);
      ctx.beginPath(); ctx.ellipse(hx, top - 0.20 * s, 0.035 * s, 0.035 * s, 0, 0, 7); stroke("#fff");
    } else if (type === "top") {
      roundRect(ctx, hx - 0.16 * s, top - 0.02 * s, 0.32 * s, 0.05 * s, 0.02 * s); stroke("#222");
      roundRect(ctx, hx - 0.10 * s, top - 0.20 * s, 0.20 * s, 0.20 * s, 0.02 * s); stroke("#222");
      roundRect(ctx, hx - 0.10 * s, top - 0.08 * s, 0.20 * s, 0.04 * s, 0.01 * s); stroke(color.accent);
    } else if (type === "crown") {
      ctx.beginPath();
      ctx.moveTo(hx - 0.14 * s, top + 0.02 * s);
      ctx.lineTo(hx - 0.14 * s, top - 0.10 * s);
      ctx.lineTo(hx - 0.07 * s, top - 0.03 * s);
      ctx.lineTo(hx, top - 0.13 * s);
      ctx.lineTo(hx + 0.07 * s, top - 0.03 * s);
      ctx.lineTo(hx + 0.14 * s, top - 0.10 * s);
      ctx.lineTo(hx + 0.14 * s, top + 0.02 * s);
      ctx.closePath(); stroke("#f2c200");
    } else if (type === "beanie") {
      ctx.beginPath(); ctx.arc(hx, top + 0.03 * s, 0.15 * s, Math.PI, 0); ctx.closePath(); stroke(color.accent);
      roundRect(ctx, hx - 0.16 * s, top + 0.01 * s, 0.32 * s, 0.05 * s, 0.02 * s); stroke("#eee");
      ctx.beginPath(); ctx.ellipse(hx, top - 0.12 * s, 0.04 * s, 0.04 * s, 0, 0, 7); stroke("#eee");
    } else if (type === "wizard") {
      ctx.beginPath();
      ctx.ellipse(hx, top + 0.04 * s, 0.18 * s, 0.04 * s, 0, 0, Math.PI * 2); stroke("#3a1f6b");
      ctx.beginPath();
      ctx.moveTo(hx - 0.13 * s, top + 0.04 * s);
      ctx.lineTo(hx + 0.13 * s, top + 0.04 * s);
      ctx.quadraticCurveTo(hx + 0.04 * s, top - 0.14 * s, hx - 0.02 * s, top - 0.26 * s);
      ctx.closePath(); stroke("#5a32a8");
      ctx.fillStyle = "#ffe066";
      star(ctx, hx - 0.02 * s, top - 0.06 * s, 0.03 * s); ctx.fill();
    } else if (type === "cap") {
      ctx.beginPath(); ctx.arc(hx, top + 0.04 * s, 0.13 * s, Math.PI, 0); ctx.closePath(); stroke(color.accent);
      ctx.beginPath(); ctx.ellipse(hx + 0.16 * s, top + 0.04 * s, 0.12 * s, 0.035 * s, 0, -0.2, Math.PI + 0.2); stroke(color.accent);
    }
  }

  function drawFace(ctx, s, type) {
    const out = Math.max(2, s * 0.022);
    if (type === "glasses") {
      ctx.strokeStyle = "#16181f"; ctx.lineWidth = out;
      ctx.beginPath(); ctx.ellipse(0.36 * s, -0.21 * s, 0.085 * s, 0.085 * s, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0.20 * s, -0.20 * s, 0.075 * s, 0.075 * s, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.275 * s, -0.205 * s); ctx.lineTo(0.285 * s, -0.205 * s); ctx.stroke();
    } else if (type === "eyepatch") {
      ctx.strokeStyle = "#16181f"; ctx.lineWidth = out * 0.8;
      ctx.beginPath(); ctx.moveTo(0.18 * s, -0.34 * s); ctx.lineTo(0.5 * s, -0.10 * s); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0.36 * s, -0.21 * s, 0.085 * s, 0.085 * s, 0, 0, 7);
      ctx.fillStyle = "#16181f"; ctx.fill();
    }
  }

  const HATS = ["none", "party", "top", "crown", "beanie", "wizard", "cap", "none", "none"];
  const PATTERNS = ["none", "stripes", "stars", "hearts", "spots", "none", "none"];

  function drawProcedural(ctx, cx, cy, h, opts) {
    const { color, seed, number, showNumber } = opts;
    const rnd = seeded(seed);
    const hatType = HATS[Math.floor(rnd() * HATS.length)];
    const patType = PATTERNS[Math.floor(rnd() * PATTERNS.length)];
    const faceType = rnd() < 0.4 ? (rnd() < 0.5 ? "glasses" : "eyepatch") : "none";
    const spikeCount = 3 + Math.floor(rnd() * 3);
    const outline = Math.max(2, h * 0.022);

    ctx.save();
    ctx.translate(cx, cy);
    const s = h;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "#16181f"; ctx.lineWidth = outline;
    const fill = (col) => { ctx.fillStyle = col; ctx.fill(); ctx.stroke(); };
    const ell = (x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };

    // Tail
    ctx.beginPath();
    ctx.moveTo(-0.28 * s, 0.06 * s);
    ctx.quadraticCurveTo(-0.58 * s, -0.02 * s, -0.52 * s, -0.22 * s);
    ctx.quadraticCurveTo(-0.40 * s, -0.10 * s, -0.22 * s, 0.0); ctx.closePath(); fill(color.dark);
    // Legs
    ell(0.16 * s, 0.30 * s, 0.10 * s, 0.12 * s); fill(color.dark);
    ell(-0.12 * s, 0.31 * s, 0.10 * s, 0.12 * s); fill(color.dark);
    // Body
    ell(0, 0.05 * s, 0.35 * s, 0.31 * s); fill(color.body);
    // Pattern or belly
    if (patType !== "none") drawPattern(ctx, s, patType, color);
    else { ell(0.03 * s, 0.12 * s, 0.22 * s, 0.20 * s); fill(color.belly); }
    // re-outline body so the stroke sits on top of the pattern
    ctx.strokeStyle = "#16181f"; ctx.lineWidth = outline;
    ell(0, 0.05 * s, 0.35 * s, 0.31 * s); ctx.stroke();

    // Dorsal spikes
    for (let i = 0; i < spikeCount; i++) {
      const t = i / (spikeCount - 1);
      const x = (-0.18 + 0.34 * t) * s;
      const y = (-0.18 - 0.10 * Math.sin(t * Math.PI)) * s;
      const sz = (0.07 + 0.03 * Math.sin(t * Math.PI)) * s;
      ctx.beginPath();
      ctx.moveTo(x - sz * 0.7, y + sz); ctx.lineTo(x, y - sz); ctx.lineTo(x + sz * 0.7, y + sz);
      ctx.closePath(); fill(color.spike);
    }
    // Front arm
    ell(0.27 * s, 0.10 * s, 0.08 * s, 0.10 * s); fill(color.body);
    // Head + snout
    ell(0.30 * s, -0.18 * s, 0.23 * s, 0.21 * s); fill(color.body);
    ell(0.46 * s, -0.12 * s, 0.10 * s, 0.08 * s); fill(color.body);

    // Horns only if no hat
    if (hatType === "none") {
      const horn = (hx, hy, dir) => {
        ctx.beginPath();
        ctx.moveTo(hx - 0.03 * s, hy); ctx.lineTo(hx + dir * 0.06 * s, hy - 0.16 * s);
        ctx.lineTo(hx + 0.03 * s, hy); ctx.closePath(); fill("#f2efe0");
      };
      horn(0.22 * s, -0.35 * s, -0.3); horn(0.34 * s, -0.36 * s, 0.3);
    }

    // Eye
    ell(0.36 * s, -0.21 * s, 0.075 * s, 0.085 * s); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
    ell(0.385 * s, -0.20 * s, 0.035 * s, 0.045 * s); ctx.fillStyle = "#16181f"; ctx.fill();
    ell(0.40 * s, -0.215 * s, 0.013 * s, 0.013 * s); ctx.fillStyle = "#fff"; ctx.fill();

    drawFace(ctx, s, faceType);
    if (hatType !== "none") drawHat(ctx, s, hatType, color);

    // Number badge
    if (showNumber) {
      const bw = 0.30 * s, bh = 0.26 * s;
      roundRect(ctx, -bw / 2 + 0.02 * s, 0.05 * s - bh / 2, bw, bh, 0.06 * s);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.strokeStyle = "#16181f"; ctx.lineWidth = outline * 0.8; ctx.stroke();
      ctx.fillStyle = "#16181f";
      ctx.font = `bold ${0.20 * s}px "Trebuchet MS", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(number), 0.02 * s, 0.06 * s);
    }
    ctx.restore();
  }

  // ---- Image sprite support ----
  let spriteImages = null;
  async function loadSprites() {
    try {
      const res = await fetch("sprites/manifest.json", { cache: "no-store" });
      if (!res.ok) return null;
      const list = await res.json();
      const imgs = await Promise.all(list.map((name) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = "sprites/" + name;
      })));
      const ok = imgs.filter(Boolean);
      spriteImages = ok.length ? ok : null;
    } catch { spriteImages = null; }
    return spriteImages;
  }

  // Shared number badge, baked onto whichever sprite (refH = creature height px).
  function drawBadge(c, x, y, refH, number) {
    const bw = 0.30 * refH, bh = 0.26 * refH;
    roundRect(c, x - bw / 2, y - bh / 2, bw, bh, 0.06 * refH);
    c.fillStyle = "#fff"; c.fill();
    c.lineWidth = Math.max(2, refH * 0.02); c.strokeStyle = "#16181f"; c.stroke();
    c.fillStyle = "#16181f";
    c.font = `bold ${0.20 * refH}px "Trebuchet MS", sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(String(number), x, y);
  }

  const DESIGN_S = 150;

  // Bake an image kaiju to a canvas sized to its OWN aspect ratio, so the
  // creature fills the frame. The race then sizes sprites by height.
  function makeImageSprite(opts) {
    const N = spriteImages.length;
    const img = spriteImages[opts.index % N];
    const ratio = img.width / img.height;
    const targetH = Math.round(DESIGN_S * 1.7);
    const pad = Math.round(targetH * 0.05);
    const w = Math.round(targetH * ratio);
    const cv = document.createElement("canvas");
    cv.width = w + pad * 2; cv.height = targetH + pad * 2;
    const c = cv.getContext("2d");
    // Recolor every racer for a vivid, varied field: spread hues across the full
    // spectrum via the golden angle (adjacent racers look very different), with a
    // little saturation variation for extra richness.
    const hue = Math.round((opts.index * 137.508) % 360);
    const sat = (0.85 + ((opts.index * 41) % 55) / 100).toFixed(2); // ~0.85–1.39
    c.save();
    c.filter = `hue-rotate(${hue}deg) saturate(${sat})`;
    c.drawImage(img, pad, pad, w, targetH);
    c.restore();
    if (opts.showNumber) drawBadge(c, cv.width / 2, pad + targetH * 0.6, targetH, opts.number);
    return cv;
  }

  function makeSprite(opts) {
    if (opts.useArt && spriteImages && spriteImages.length) return makeImageSprite(opts);
    // Procedural fallback: square canvas, creature centered.
    const D = Math.round(DESIGN_S * 1.7);
    const cv = document.createElement("canvas");
    cv.width = D; cv.height = D;
    drawProcedural(cv.getContext("2d"), D / 2, D / 2, DESIGN_S, opts);
    return cv;
  }

  return {
    makeSprite, palette, loadSprites,
    hasSprites: () => !!(spriteImages && spriteImages.length),
  };
})();
