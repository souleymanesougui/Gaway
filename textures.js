import * as THREE from 'three';

/* ============================================================
   TEXTURES.JS — génération procédurale de textures réalistes
   via canvas 2D. Aucune image externe requise (donc jamais
   d'asset manquant / lien cassé), tout en évitant les couleurs
   plates façon "low-poly".
   ============================================================ */

function canvasTex(size, draw, repeat = [4, 4]) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function noiseFill(ctx, size, base, variance) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const cells = 90;
  for (let i = 0; i < cells * cells * 0.35; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const s = 1 + Math.random() * 2.5;
    const v = (Math.random() - 0.5) * variance;
    ctx.fillStyle = shade(base, v);
    ctx.globalAlpha = 0.5 + Math.random() * 0.4;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.r = clamp01(c.r + amt); c.g = clamp01(c.g + amt); c.b = clamp01(c.b + amt);
  return '#' + c.getHexString();
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// ---------- Grass (jardin / pelouse) ----------
export function grassTexture(repeat = [24, 24]) {
  return canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, '#3f6b3a', 0.12);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      ctx.strokeStyle = shade('#3f6b3a', (Math.random() - 0.3) * 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 4 - Math.random() * 3);
      ctx.stroke();
    }
  }, repeat);
}

// ---------- Asphalt (route) ----------
export function asphaltTexture(repeat = [1, 8]) {
  return canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, '#2a2c30', 0.05);
  }, repeat);
}

// ---------- Concrete (trottoir / allée / garage) ----------
export function concreteTexture(repeat = [4, 4]) {
  return canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, '#b8b2a6', 0.05);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 2;
    for (let i = 0; i < s; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
    }
  }, repeat);
}

// ---------- Brick wall ----------
export function brickTexture(repeat = [3, 2], baseColor = '#8a3f30') {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#c9c3b8';
    ctx.fillRect(0, 0, s, s);
    const bw = 32, bh = 14, mortar = 3;
    let row = 0;
    for (let y = 0; y < s; y += bh + mortar) {
      const offset = (row % 2 === 0) ? 0 : bw / 2;
      for (let x = -bw; x < s + bw; x += bw + mortar) {
        ctx.fillStyle = shade(baseColor, (Math.random() - 0.5) * 0.18);
        ctx.fillRect(x + offset, y, bw, bh);
      }
      row++;
    }
  }, repeat);
}

// ---------- Stone (soubassement, style cottage) ----------
export function stoneTexture(repeat = [3, 3]) {
  return canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, '#8a8478', 0.07);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 14 + Math.random() * 18;
      ctx.strokeStyle = 'rgba(60,55,48,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, repeat);
}

// ---------- Wood planks ----------
export function woodTexture(repeat = [2, 4], baseColor = '#6b4530') {
  return canvasTex(256, (ctx, s) => {
    const plankH = 22;
    for (let y = 0; y < s; y += plankH) {
      const c = shade(baseColor, (Math.random() - 0.5) * 0.12);
      ctx.fillStyle = c;
      ctx.fillRect(0, y, s, plankH - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.moveTo(0, y + plankH - 2); ctx.lineTo(s, y + plankH - 2); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const gx = Math.random() * s;
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + (Math.random() - 0.5) * 10, y + plankH); ctx.stroke();
      }
    }
  }, repeat);
}

// ---------- Marble ----------
export function marbleTexture(repeat = [2, 2]) {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#f1eee8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 10; i++) {
      ctx.strokeStyle = `rgba(150,150,150,${0.15 + Math.random() * 0.2})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      let x = Math.random() * s, y = 0;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (Math.random() - 0.5) * 60;
        y += s / 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, repeat);
}

// ---------- Stucco (crépi moderne) ----------
export function stuccoTexture(repeat = [3, 3], baseColor = '#e7e2d6') {
  return canvasTex(256, (ctx, s) => { noiseFill(ctx, s, baseColor, 0.04); }, repeat);
}

// ---------- Roof shingles ----------
export function shingleTexture(repeat = [4, 4], baseColor = '#3a3f45') {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, s, s);
    const rowH = 18, tileW = 20;
    let row = 0;
    for (let y = 0; y < s; y += rowH) {
      const offset = (row % 2 === 0) ? 0 : tileW / 2;
      for (let x = -tileW; x < s + tileW; x += tileW) {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + offset, y, tileW, rowH);
        ctx.fillStyle = shade(baseColor, (Math.random() - 0.5) * 0.08);
        ctx.fillRect(x + offset + 1, y + 1, tileW - 2, rowH - 2);
      }
      row++;
    }
  }, repeat);
}

// ---------- Water (piscine) — motif animable via offset UV ----------
export function waterTexture(repeat = [3, 3]) {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#1c6f8c';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.08})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + 10, s * 0.6, y - 10, s, y);
      ctx.stroke();
    }
  }, repeat);
}

// ---------- Pool tile (bordure) ----------
export function poolTileTexture(repeat = [6, 1]) {
  return canvasTex(128, (ctx, s) => {
    const tile = 16;
    for (let y = 0; y < s; y += tile) {
      for (let x = 0; x < s; x += tile) {
        ctx.fillStyle = Math.random() > 0.5 ? '#2f6fa3' : '#3a86bf';
        ctx.fillRect(x, y, tile - 1, tile - 1);
      }
    }
  }, repeat);
}

// ---------- Abstract art (tableaux intérieurs) ----------
export function abstractArtTexture(seed = 0) {
  return canvasTex(128, (ctx, s) => {
    const rnd = mulberry32(seed + 1);
    ctx.fillStyle = ['#e8e2d4', '#e4d8c8', '#dfe6e8'][Math.floor(rnd() * 3)];
    ctx.fillRect(0, 0, s, s);
    const palette = ['#8E44AD', '#3498db', '#e74c3c', '#2c3e50', '#d8a13a'];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
      ctx.globalAlpha = 0.7;
      const x = rnd() * s, y = rnd() * s, r = 10 + rnd() * 30;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + rnd()), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [1, 1]);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
