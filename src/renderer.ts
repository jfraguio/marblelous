import type { Game } from './game';
import type { Marble, Piece } from './types';
import {
  drawBubbleSprite,
  drawMarbleSprite,
  drawPiece,
  drawSoftShadow,
  getPieceShadow,
  LIGHT_X,
  LIGHT_Y,
  setSpriteBudget
} from './art';
import {
  MARBLE_BY_ID,
  NOTE_COLORS,
  PALETTE,
  getPieceDef,
  pieceHitSize,
  spiralLocal,
  xyloLayout
} from './pieces';
import { PostFX } from './postfx';
import { clamp, hash2, lerp, prefersReducedMotion, rgba, TAU, CAMERA_TILT } from './util';
import { WORLD_THEMES, worldTheme } from './worlds';

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

const SHADOW_OFF_X = -LIGHT_X * 13;
const SHADOW_OFF_Y = -LIGHT_Y * 13;
const ELLIPSE_SHADOW = new Set([
  'spiral',
  'portal',
  'fan',
  'booster',
  'star',
  'electromagnet'
]);

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: Game;
  private post = new PostFX();
  private theme = WORLD_THEMES[0];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private level = 0;
  private qualitySetting = 'auto';
  private avgFrame = 16.7;
  private lastFrame = 0;
  private lastCheck = 0;
  private lastRender = 0;
  private dust: Dust[] = [];
  private prevAir = new Map<number, number>();

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.canvas = canvas;
    this.game = game;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
    this.resize(true);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.resize(), 120));
    this.lastFrame = performance.now();
    this.lastCheck = this.lastFrame;
    this.lastRender = this.lastFrame;
  }

  setLevel(level: number) {
    const next = clamp(Math.round(level), 0, 2);
    if (next === this.level) return;
    this.level = next;
    setSpriteBudget(next === 2 ? 70 : next === 1 ? 100 : 140);
    this.resize(true);
  }

  getLevel() {
    return this.level;
  }

  private resize(force = false) {
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const cap = this.level === 0 ? 2 : this.level === 1 ? 1.5 : 1.25;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (!force && cssW === this.width && cssH === this.height && Math.abs(dpr - this.dpr) < 0.01) return;
    this.width = cssW;
    this.height = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.game.setViewport(cssW, cssH);
  }

  render(alpha: number, now: number) {
    const g = this.game;
    this.checkQuality(now);
    if (this.qualitySetting !== g.settings.quality) {
      this.qualitySetting = g.settings.quality;
      if (this.qualitySetting === 'high') this.setLevel(0);
      else if (this.qualitySetting === 'low') this.setLevel(2);
    }
    const ctx = this.ctx;
    const cam = g.camera;
    const w = this.width;
    const h = this.height;
    const dpr = this.dpr;
    const reduced = prefersReducedMotion();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastRender) / 1000));
    this.lastRender = now;
    const zoom = cam.zoom;
    this.theme = worldTheme(g.activeWorld);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.theme.paper;
    ctx.fillRect(0, 0, w, h);
    this.drawBackdrop(ctx, w, h, cam, now);

    // visible world rect
    const minX = cam.x - w / 2 / zoom - 80;
    const maxX = cam.x + w / 2 / zoom + 80;
    const minY = cam.y - h / 2 / (zoom * CAMERA_TILT) - 80;
    const maxY = cam.y + h / 2 / (zoom * CAMERA_TILT) + 80;

    ctx.setTransform(
      zoom * dpr,
      0,
      0,
      zoom * CAMERA_TILT * dpr,
      (w / 2 - cam.x * zoom) * dpr,
      (h / 2 - cam.y * zoom * CAMERA_TILT) * dpr
    );
    this.drawGrid(minX, maxX, minY, maxY, zoom);

    // Orden por profundidad: lo que está más abajo se dibuja encima.
    const visible: Piece[] = [];
    for (const p of g.pieces) {
      if (p.disabledUntil && p.disabledUntil > now) continue;
      if (p.x < minX - 420 || p.x > maxX + 420 || p.y < minY - 420 || p.y > maxY + 420) continue;
      visible.push(p);
    }
    visible.sort((a, b) => a.y - b.y);

    // Sombra de contacto de todas las piezas (debajo de todas).
    if (this.level < 2) {
      for (const p of visible) this.drawPieceShadow(ctx, p);
    }

    for (const p of visible) {
      this.drawWorldPiece(ctx, p, now, zoom);
    }

    // ghost piece under marbles
    if (g.ghost && g.ghost.kind === 'piece') {
      const def = getPieceDef(g.ghost.defId);
      const temp: Piece = {
        id: -1,
        defId: g.ghost.defId,
        x: g.ghost.x,
        y: g.ghost.y,
        rot: g.ghost.rot,
        len: def.id === 'ramp' ? 160 : 0,
        color: def.defaultColor,
        variant: 0
      };
      if (this.level < 2) this.drawPieceShadow(ctx, temp);
      ctx.save();
      ctx.globalAlpha = 0.48;
      ctx.translate(temp.x, temp.y);
      ctx.rotate(temp.rot);
      drawPiece(ctx, temp);
      ctx.restore();
      // dashed outline
      ctx.save();
      ctx.translate(temp.x, temp.y);
      ctx.rotate(temp.rot);
      ctx.strokeStyle = rgba(this.theme.ink, 0.35);
      ctx.lineWidth = 1.6 / zoom;
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      const hs = pieceHitSize(temp);
      ctx.strokeRect(-hs.w / 2, -hs.h / 2, hs.w, hs.h);
      ctx.restore();
    }

    for (const m of g.marbles) {
      if (!m.alive) continue;
      if (m.x < minX || m.x > maxX || m.y < minY || m.y > maxY) continue;
      this.landingDust(m, reduced);
      this.drawMarble(ctx, m, alpha, now, reduced);
    }
    if (this.prevAir.size > 400) this.prevAir.clear();
    this.updateDust(dt);
    this.drawDust(ctx);

    this.drawParticles(ctx, now);
    this.drawPopups(ctx);

    if (g.selectedPieceId) {
      const p = g.selectedPiece;
      if (p) this.drawSelection(ctx, p, zoom);
    }

    if (g.dropPreview) {
      this.drawDropPreview(ctx, g.dropPreview, zoom);
    }

    if (g.ghost && g.ghost.kind === 'marble') {
      const type = MARBLE_BY_ID.get(g.ghost.typeId);
      if (type) {
        if (this.level < 2) drawSoftShadow(ctx, g.ghost.x + 4, g.ghost.y + 9, type.r * 1.9, type.r * 0.95, 0.35);
        drawMarbleSprite(ctx, type, g.ghost.x, g.ghost.y, type.r * 1.15, 0.6);
      }
    }

    this.post.apply(ctx, this.canvas, w, h, dpr, this.level, now);
  }

  /** Fondo de estudio: charco de luz y penumbra con parallax leve. */
  private drawBackdrop(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cam: { x: number; y: number },
    now: number
  ) {
    const theme = this.theme;
    const px = clamp(-cam.x * 0.018, -90, 90);
    const py = clamp(-cam.y * 0.018, -70, 70);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.00022);
    const space = theme.kind === 'space';
    const volcano = theme.kind === 'volcano';
    const warm = space ? '120,150,255' : volcano ? '255,120,50' : '255,252,242';

    const g1 = ctx.createRadialGradient(w * 0.26 + px, h * 0.1 + py, 0, w * 0.26 + px, h * 0.1 + py, Math.max(w, h) * 0.95);
    g1.addColorStop(0, theme.light);
    g1.addColorStop(0.55, `rgba(${warm},${space ? 0.045 : volcano ? 0.07 : 0.09})`);
    g1.addColorStop(1, `rgba(${warm},0)`);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(
      w * 0.82 - px * 0.6,
      h * 0.92 - py * 0.6,
      0,
      w * 0.82 - px * 0.6,
      h * 0.92 - py * 0.6,
      Math.max(w, h) * 0.85
    );
    g2.addColorStop(0, theme.shade);
    g2.addColorStop(1, space ? 'rgba(0,0,0,0)' : 'rgba(35,33,28,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    this.drawWorldDecor(ctx, w, h, cam, now, pulse);
  }

  private drawWorldDecor(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cam: { x: number; y: number },
    now: number,
    pulse: number
  ) {
    const kind = this.theme.kind;
    const ox = clamp(-cam.x * 0.03, -60, 60);
    const oy = clamp(-cam.y * 0.03, -40, 40);

    if (kind === 'ocean') {
      // Rayos de luz oblicuos.
      ctx.fillStyle = `rgba(255,255,255,${0.03 + pulse * 0.015})`;
      for (let i = 0; i < 4; i++) {
        const x = w * (0.12 + i * 0.16) + ox;
        ctx.beginPath();
        ctx.moveTo(x, -20);
        ctx.lineTo(x + 90, -20);
        ctx.lineTo(x - 150, h + 20);
        ctx.lineTo(x - 240, h + 20);
        ctx.closePath();
        ctx.fill();
      }

      // Cáusticas por bandas.
      ctx.strokeStyle = 'rgba(46,158,151,0.13)';
      ctx.lineWidth = 1.7;
      ctx.lineCap = 'round';
      for (let band = 0; band < 6; band++) {
        const base = band < 3 ? h * (0.1 + band * 0.055) : h * (0.82 + (band - 3) * 0.055);
        ctx.beginPath();
        for (let x = -20; x <= w + 20; x += 18) {
          const y = base + Math.sin(x * 0.013 + now * 0.0011 + band * 1.7) * (4 + band * 0.7);
          if (x === -20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Lecho y grava.
      const sand = ctx.createLinearGradient(0, h * 0.88, 0, h);
      sand.addColorStop(0, 'rgba(233,180,76,0)');
      sand.addColorStop(1, 'rgba(233,180,76,0.09)');
      ctx.fillStyle = sand;
      ctx.fillRect(0, h * 0.88, w, h * 0.12);
      ctx.fillStyle = 'rgba(46,158,151,0.12)';
      for (let i = 0; i < 18; i++) {
        const seed = hash2(i + 31, 5);
        const x = ((seed % 1000) / 1000) * w + ox;
        const y = h * 0.93 + ((seed >>> 8) % 30);
        ctx.beginPath();
        ctx.ellipse(x, y, 3 + ((seed >>> 12) % 5), 1.6, 0, 0, TAU);
        ctx.fill();
      }

      // Burbujas.
      for (let i = 0; i < 22; i++) {
        const seed = hash2(i + 1, 7);
        const x = ((seed % 1000) / 1000) * w + ox;
        const r = 2 + ((seed >>> 10) % 5);
        const baseY = ((seed >>> 4) % 1000) / 1000;
        const y = ((baseY * h - now * 0.007 + i * 40) % (h + 80) + h + 80) % (h + 80) - 40;
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(46,158,151,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(x - r * 0.3, y - r * 0.35, Math.max(0.8, r * 0.22), 0, TAU);
        ctx.fill();
      }

      // Algas y peces.
      ctx.strokeStyle = 'rgba(46,158,151,0.1)';
      ctx.fillStyle = 'rgba(46,158,151,0.09)';
      for (let i = 0; i < 7; i++) {
        const bx = (i < 4 ? w * 0.04 + i * 28 : w * 0.92 - (i - 4) * 26) + ox * 0.6;
        const hgt = 60 + (i % 3) * 34;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bx, h + 10);
        ctx.bezierCurveTo(bx - 14, h - hgt * 0.4, bx + 20, h - hgt * 0.7, bx + 2, h - hgt);
        ctx.stroke();
        for (let k = 1; k <= 3; k++) {
          const t = k / 4;
          const lx = bx + Math.sin(t * 3 + i) * 8;
          const ly = h - hgt * t;
          ctx.beginPath();
          ctx.ellipse(lx + (k % 2 ? 8 : -8), ly, 7, 3, k % 2 ? 0.6 : -0.6, 0, TAU);
          ctx.fill();
        }
      }
      ctx.strokeStyle = 'rgba(46,158,151,0.13)';
      ctx.fillStyle = 'rgba(46,158,151,0.12)';
      for (let i = 0; i < 3; i++) {
        const fx = w * (0.3 + i * 0.18) + ox + Math.sin(now * 0.0004 + i) * 20;
        const fy = h * (0.62 + i * 0.07) + oy;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 10, 4, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(fx - 10, fy);
        ctx.lineTo(fx - 16, fy - 4);
        ctx.lineTo(fx - 16, fy + 4);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    if (kind === 'sky') {
      const sun = ctx.createRadialGradient(w * 0.82 + ox, h * 0.16 + oy, 0, w * 0.82 + ox, h * 0.16 + oy, 190);
      sun.addColorStop(0, 'rgba(255,255,255,0.32)');
      sun.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      const clouds: [number, number, number][] = [
        [0.16, 0.18, 1],
        [0.68, 0.24, 0.9],
        [0.42, 0.1, 0.65],
        [0.88, 0.58, 0.7],
        [0.1, 0.68, 0.55],
        [0.55, 0.42, 0.45],
        [0.32, 0.82, 0.5]
      ];
      for (let i = 0; i < clouds.length; i++) {
        const [cx, cy, sc] = clouds[i];
        const drift = Math.sin(now * 0.00006 + i * 2.1) * 30;
        const x = cx * w + ox * 0.7 + drift;
        const y = cy * h + oy * 0.5;
        const rr = 58 * sc;
        ctx.fillStyle = 'rgba(110,140,170,0.06)';
        ctx.beginPath();
        ctx.ellipse(x + 4, y + 10, rr * 1.55, rr * 0.45, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        ctx.beginPath();
        ctx.ellipse(x, y, rr * 1.5, rr * 0.5, 0, 0, TAU);
        ctx.ellipse(x - rr, y + rr * 0.15, rr * 0.8, rr * 0.38, 0, 0, TAU);
        ctx.ellipse(x + rr * 1.1, y + rr * 0.12, rr * 0.9, rr * 0.4, 0, 0, TAU);
        ctx.ellipse(x + rr * 0.35, y - rr * 0.2, rr * 0.7, rr * 0.32, 0, 0, TAU);
        ctx.fill();
      }

      // Globo aerostático.
      const bx = w * 0.18 + ox * 0.8;
      const by = h * 0.38 + oy * 0.5 + Math.sin(now * 0.0004) * 6;
      ctx.fillStyle = 'rgba(217,93,57,0.16)';
      ctx.beginPath();
      ctx.ellipse(bx, by, 26, 32, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(233,180,76,0.24)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 31);
      ctx.quadraticCurveTo(bx + 10, by, bx, by + 31);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(35,33,28,0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx - 8, by + 28);
      ctx.lineTo(bx - 6, by + 42);
      ctx.lineTo(bx + 6, by + 42);
      ctx.lineTo(bx + 8, by + 28);
      ctx.stroke();
      ctx.fillStyle = 'rgba(217,93,57,0.14)';
      ctx.fillRect(bx - 6, by + 42, 12, 8);

      ctx.strokeStyle = 'rgba(60,90,120,0.16)';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const seed = hash2(i + 3, 11);
        const x = ((seed % 1000) / 1000) * w * 0.7 + w * 0.2 + ox;
        const y = h * 0.16 + ((seed >>> 8) % 100) + oy;
        const flap = Math.sin(now * 0.002 + i) * 2.8;
        ctx.beginPath();
        ctx.moveTo(x - 8, y + flap);
        ctx.quadraticCurveTo(x - 2, y - 4, x, y);
        ctx.quadraticCurveTo(x + 2, y - 4, x + 8, y + flap);
        ctx.stroke();
      }
      return;
    }

    if (kind === 'space') {
      const neb = ctx.createRadialGradient(w * 0.72 + ox * 0.4, h * 0.3 + oy * 0.4, 0, w * 0.72 + ox * 0.4, h * 0.3 + oy * 0.4, Math.max(w, h) * 0.62);
      neb.addColorStop(0, 'rgba(125,91,166,0.16)');
      neb.addColorStop(0.5, 'rgba(61,126,166,0.07)');
      neb.addColorStop(1, 'rgba(11,14,28,0)');
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, w, h);
      const neb2 = ctx.createRadialGradient(w * 0.25 + ox * 0.3, h * 0.72 + oy * 0.3, 0, w * 0.25 + ox * 0.3, h * 0.72 + oy * 0.3, Math.max(w, h) * 0.5);
      neb2.addColorStop(0, 'rgba(46,158,151,0.08)');
      neb2.addColorStop(1, 'rgba(11,14,28,0)');
      ctx.fillStyle = neb2;
      ctx.fillRect(0, 0, w, h);

      const px = w * 0.84 + ox;
      const py = h * 0.2 + oy;
      const planet = ctx.createRadialGradient(px - 18, py - 22, 6, px, py, 82);
      planet.addColorStop(0, 'rgba(180,150,230,0.3)');
      planet.addColorStop(0.65, 'rgba(125,91,166,0.17)');
      planet.addColorStop(1, 'rgba(61,126,166,0.03)');
      ctx.fillStyle = planet;
      ctx.beginPath();
      ctx.arc(px, py, 78, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,150,230,0.14)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(px, py, 108, 26, -0.4, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(220,230,255,0.08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, py, 78, 20, -0.4, 0, TAU);
      ctx.stroke();

      const moon = ctx.createRadialGradient(w * 0.72 + ox, h * 0.32 + oy, 1, w * 0.72 + ox, h * 0.32 + oy, 12);
      moon.addColorStop(0, 'rgba(220,230,255,0.3)');
      moon.addColorStop(1, 'rgba(220,230,255,0)');
      ctx.fillStyle = moon;
      ctx.beginPath();
      ctx.arc(w * 0.72 + ox, h * 0.32 + oy, 12, 0, TAU);
      ctx.fill();

      for (let i = 0; i < 150; i++) {
        const seed = hash2(i + 1, 23);
        const x = ((seed % 1000) / 1000) * w;
        const y = (((seed >>> 9) % 1000) / 1000) * h;
        const tw = 0.18 + 0.3 * (0.5 + 0.5 * Math.sin(now * 0.0012 + i * 1.7));
        const big = (seed >>> 20) % 11 === 0;
        const size = big ? 2.4 : 1.2;
        ctx.fillStyle = `rgba(220,230,255,${tw})`;
        ctx.fillRect(x + ox * 0.3, y + oy * 0.3, size, size);
        if (big) {
          ctx.strokeStyle = `rgba(220,230,255,${tw * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - 5 + ox * 0.3, y + oy * 0.3);
          ctx.lineTo(x + 7 + ox * 0.3, y + oy * 0.3);
          ctx.moveTo(x + ox * 0.3, y - 5 + oy * 0.3);
          ctx.lineTo(x + ox * 0.3, y + 7 + oy * 0.3);
          ctx.stroke();
        }
      }

      // Cometa.
      const cx = ((now * 0.006) % (w + 240)) - 120;
      const cy = h * 0.58 + Math.sin(now * 0.0006) * 12;
      ctx.strokeStyle = 'rgba(180,220,255,0.16)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 74, cy + 22);
      ctx.stroke();
      ctx.fillStyle = 'rgba(220,240,255,0.7)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, TAU);
      ctx.fill();
      return;
    }

    if (kind === 'volcano') {
      // Halo de lava que respira desde la base.
      const glow = ctx.createRadialGradient(
        w * 0.5,
        h * 1.04,
        0,
        w * 0.5,
        h * 1.04,
        Math.max(w, h) * 0.82
      );
      glow.addColorStop(0, `rgba(255,110,40,${0.2 + pulse * 0.07})`);
      glow.addColorStop(0.5, 'rgba(190,50,20,0.075)');
      glow.addColorStop(1, 'rgba(190,50,20,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Grietas magmáticas: trazos finos con brillo anaranjado y ramas.
      ctx.save();
      ctx.translate(ox, oy);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const crack = (pts: { x: number; y: number }[], width: number) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.strokeStyle = 'rgba(55,8,6,0.7)';
        ctx.lineWidth = width + 5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,84,26,${0.2 + pulse * 0.14})`;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,206,132,${0.32 + pulse * 0.2})`;
        ctx.lineWidth = Math.max(1, width * 0.36);
        ctx.stroke();
      };
      for (let i = 0; i < 13; i++) {
        const seed = hash2(i + 61, 29);
        let x = ((seed % 1000) / 1000) * w;
        let y = (((seed >>> 9) % 1000) / 1000) * h;
        let a = ((seed >>> 18) % 360) * (Math.PI / 180);
        const pts = [{ x, y }];
        for (let s = 0; s < 8; s++) {
          a += ((((seed >>> (s * 3)) % 100) / 100) - 0.5) * 1.15;
          const step = 12 + ((seed >>> ((s + 2) * 2)) % 26);
          x += Math.cos(a) * step;
          y += Math.sin(a) * step;
          pts.push({ x, y });
        }
        crack(pts, 1.6 + ((seed >>> 7) % 18) / 10);

        // Rama corta que nace de un punto intermedio.
        const base = pts[2 + (seed % 4)];
        let ba = a + (seed % 2 ? 1 : -1) * (0.7 + ((seed >>> 11) % 50) / 100);
        let bx = base.x;
        let by = base.y;
        const branch = [{ x: bx, y: by }];
        for (let s = 0; s < 4; s++) {
          ba += ((((seed >>> (s * 4 + 3)) % 100) / 100) - 0.5) * 1.4;
          bx += Math.cos(ba) * (10 + ((seed >>> (s + 5)) % 16));
          by += Math.sin(ba) * (10 + ((seed >>> (s + 5)) % 16));
          branch.push({ x: bx, y: by });
        }
        crack(branch, 1.1);
      }
      ctx.restore();

      // Brasas que suben lentamente.
      for (let i = 0; i < 26; i++) {
        const seed = hash2(i + 5, 41);
        const x = ((seed % 1000) / 1000) * w + ox * 0.5;
        const baseY = ((seed >>> 8) % 1000) / 1000;
        const y = ((baseY * h - now * 0.012 - i * 13) % (h + 60) + h + 60) % (h + 60) - 30;
        const flicker = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.002 + i * 2.3));
        const r = 1 + ((seed >>> 17) % 3) * 0.7;
        ctx.fillStyle = `rgba(255,${140 + (seed % 60)},60,${flicker * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }

      // Lago de lava en el borde inferior.
      const lava = ctx.createLinearGradient(0, h * 0.84, 0, h);
      lava.addColorStop(0, 'rgba(255,90,30,0)');
      lava.addColorStop(1, 'rgba(255,90,30,0.16)');
      ctx.fillStyle = lava;
      ctx.fillRect(0, h * 0.84, w, h * 0.16);
      ctx.strokeStyle = `rgba(255,170,90,${0.16 + pulse * 0.1})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = -20; x <= w + 20; x += 16) {
        const y = h - 16 + Math.sin(x * 0.016 + now * 0.0009) * 4 + Math.sin(x * 0.041) * 1.6;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    // Estudio: polvo y fibras de papel.
    ctx.fillStyle = 'rgba(35,33,28,0.045)';
    for (let i = 0; i < 30; i++) {
      const seed = hash2(i + 5, 3);
      const x = ((seed % 1000) / 1000) * w + Math.sin(now * 0.0002 + i) * 10;
      const y = (((seed >>> 8) % 1000) / 1000) * h + Math.cos(now * 0.00017 + i * 1.3) * 8;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
    ctx.strokeStyle = 'rgba(35,33,28,0.025)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const seed = hash2(i + 41, 9);
      const x = ((seed % 1000) / 1000) * w;
      const y = (((seed >>> 8) % 1000) / 1000) * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18 + (seed % 20), y + Math.sin(i) * 6);
      ctx.stroke();
    }
    void pulse;
  }

  private drawPieceShadow(ctx: CanvasRenderingContext2D, p: Piece) {
    if (ELLIPSE_SHADOW.has(p.defId)) {
      const hs = pieceHitSize(p);
      const wide = hs.w * 0.62;
      const tall = p.defId === 'fan' ? 150 : Math.max(16, hs.h * 0.5);
      drawSoftShadow(ctx, p.x + SHADOW_OFF_X * 0.8, p.y + SHADOW_OFF_Y * 0.9, wide, tall, 0.26);
      return;
    }
    const sh = getPieceShadow(p);
    ctx.save();
    ctx.translate(p.x + SHADOW_OFF_X, p.y + SHADOW_OFF_Y);
    if (p.rot) ctx.rotate(p.rot);
    ctx.globalAlpha = 0.46;
    ctx.drawImage(sh.canvas, -sh.w / 2, -sh.h / 2, sh.w, sh.h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Polvo y mini onda al aterrizar una canica. */
  private landingDust(m: Marble, reduced: boolean) {
    const prev = this.prevAir.get(m.id) ?? 0;
    this.prevAir.set(m.id, m.airTime);
    if (reduced || prev < 0.32 || m.airTime > 0.001) return;
    const n = prev > 0.8 ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const speed = 24 + Math.random() * 46;
      this.dust.push({
        x: m.x + Math.cos(a) * m.r * 0.7,
        y: m.y + m.r * 0.6 + Math.sin(a) * m.r * 0.3,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed * 0.45 - 12,
        life: 0.36 + Math.random() * 0.24,
        maxLife: 0.6,
        size: 1.8 + Math.random() * 2.8
      });
    }
  }

  private updateDust(dt: number) {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.dust.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 1 - dt * 3.4;
      d.vy = d.vy * (1 - dt * 2.2) + 26 * dt;
    }
  }

  private drawDust(ctx: CanvasRenderingContext2D) {
    for (const d of this.dust) {
      const t = clamp(d.life / d.maxLife, 0, 1);
      ctx.globalAlpha = t * 0.62;
      ctx.fillStyle = PALETTE.paper3;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size * (1.4 - t * 0.5), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawGrid(minX: number, maxX: number, minY: number, maxY: number, zoom: number) {
    if (zoom < 0.58) return;
    const ctx = this.ctx;
    const step = 40;
    const startX = Math.floor(minX / step) * step;
    const startY = Math.floor(minY / step) * step;
    const maxDots = 4200;
    const n = ((maxX - minX) / step) * ((maxY - minY) / step);
    if (n > maxDots) return;
    ctx.fillStyle = this.theme.grid;
    const size = 2.3;
    for (let x = startX; x <= maxX; x += step) {
      for (let y = startY; y <= maxY; y += step) {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }

  private drawWorldPiece(ctx: CanvasRenderingContext2D, p: Piece, now: number, zoom: number) {
    if ((p.defId === 'star' || p.defId === 'bubble' || p.defId === 'hourglass') && p.disabledUntil && p.disabledUntil > now) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.bornAt) {
      const age = now - p.bornAt;
      if (age >= 0 && age < 150) {
        const s = 0.9 + 0.1 * (age / 150);
        ctx.scale(s, s);
      }
    }
    if (p.rot) ctx.rotate(p.rot);

    const def = getPieceDef(p.defId);
    if (def.id === 'goal' && p.anim) {
      const age = (now - p.anim) / 1000;
      if (age >= 0 && age < 0.7) {
        ctx.rotate(Math.sin(age * 28) * 0.075 * Math.exp(-age * 3.2));
      }
    }
    if (def.id === 'bumper' && p.flash) {
      const age = (now - p.flash) / 1000;
      if (age >= 0 && age < 0.24) {
        const k = Math.exp(-age * 17);
        ctx.scale(1 + 0.09 * k, 1 - 0.12 * k);
      }
    }
    if (def.id === 'bubble' && p.anim) {
      ctx.translate(Math.sin(now * 0.09) * 1.6, 0);
    }

    drawPiece(ctx, p);

    if (def.id === 'electromagnet') {
      const attract = (p.polarity ?? 1) >= 0;
      const rgb = attract ? '46,158,151' : '217,93,57';
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      ctx.strokeStyle = `rgba(${rgb},${0.14 + 0.12 * pulse})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = attract ? -now * 0.03 : now * 0.03;
      ctx.beginPath();
      ctx.arc(0, 0, 150, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = `rgba(${rgb},0.52)`;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = now * 0.0006 + (i * TAU) / 4;
        const r0 = attract ? 118 : 98;
        const r1 = attract ? 98 : 118;
        const x0 = Math.cos(a) * r0;
        const y0 = Math.sin(a) * r0;
        const x1 = Math.cos(a) * r1;
        const y1 = Math.sin(a) * r1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        const head = attract ? Math.atan2(y1 - y0, x1 - x0) : Math.atan2(y0 - y1, x0 - x1);
        ctx.lineTo(x1 - Math.cos(head - 0.5) * 8, y1 - Math.sin(head - 0.5) * 8);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(head + 0.5) * 8, y1 - Math.sin(head + 0.5) * 8);
        ctx.stroke();
      }
    }

    if (def.id === 'bubbleLift') {
      const k = 0.5 + 0.5 * Math.sin(now * 0.003);
      ctx.strokeStyle = `rgba(143,211,238,${0.12 + 0.12 * k})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, -8, 52 + k * 4, 52 + k * 4, 0, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const yy = -64 - ((now * 0.03 + i * 34) % 70);
        drawBubbleSprite(ctx, -20 + i * 20, yy, 4.5, 0.5);
      }
    }

    if (p.defId === 'conveyor') {
      const offset = (now * 0.07) % 54;
      const span = 320;
      ctx.strokeStyle = 'rgba(255,253,248,0.38)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = -160 + ((offset + i * 54) % span);
        ctx.beginPath();
        ctx.moveTo(x - 6, -4);
        ctx.lineTo(x, 1);
        ctx.lineTo(x - 6, 6);
        ctx.stroke();
      }
    }

    if (p.defId === 'booster') {
      const pulse = 0.12 + 0.06 * Math.sin(now * 0.006);
      ctx.strokeStyle = rgba(PALETTE.teal, pulse);
      ctx.lineWidth = 2;
      ctx.strokeRect(-38, -38, 76, 76);
    }

    if (p.defId === 'star' && (!p.disabledUntil || p.disabledUntil < now)) {
      const pulse = 0.09 + 0.05 * Math.sin(now * 0.005);
      ctx.fillStyle = rgba(PALETTE.yellow, pulse);
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(now * 0.005) * 2, 0, TAU);
      ctx.fill();
    }

    if (p.defId === 'bubble' && p.anim && (!p.disabledUntil || p.disabledUntil < now)) {
      const age = (now - p.anim) / 1000;
      if (age >= 0 && age < 0.25) {
        const k = Math.min(1, age / 0.2);
        ctx.strokeStyle = `rgba(255,255,255,${0.3 + k * 0.55})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-46, 0);
        ctx.lineTo(-24, -5);
        ctx.lineTo(-4, 4);
        ctx.lineTo(18, -3);
        ctx.lineTo(42, 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-12, -6);
        ctx.lineTo(-8, 6);
        ctx.moveTo(24, -5);
        ctx.lineTo(28, 5);
        ctx.stroke();
      }
    }

    if (p.defId === 'portal') {
      for (const x of [-62, 62]) {
        ctx.save();
        ctx.translate(x, 0);
        ctx.rotate(now * 0.0012 * (x < 0 ? 1 : -1));
        ctx.strokeStyle = rgba(PALETTE.paper3, 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 19, 0.2, 2.4);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (p.defId === 'fan') {
      const off = (now * 0.09) % 56;
      ctx.strokeStyle = rgba(PALETTE.teal, 0.55);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        const y = -90 + ((i * 56 + off) % 180);
        ctx.beginPath();
        ctx.moveTo(-10, y + 8);
        ctx.lineTo(0, y);
        ctx.lineTo(10, y + 8);
        ctx.stroke();
      }
    }

    if (p.defId === 'spiral' && p.flash) {
      const age = now - p.flash;
      if (age >= 0 && age < 150) {
        const t = Math.min(1, Math.max(0, ((p.flashNote ?? 0) + 1) / 8));
        const lo = spiralLocal(t);
        ctx.fillStyle = `rgba(255,253,248,${(1 - age / 150) * 0.75})`;
        ctx.beginPath();
        ctx.arc(lo.x, lo.y, 11, 0, TAU);
        ctx.fill();
      }
    }

    if (p.flash) {
      const age = now - p.flash;
      if (age >= 0 && age < 140) {
        const a = (1 - age / 140) * 0.75;
        if (p.defId === 'xylo5') {
          const n = 5;
          const layout = xyloLayout(n);
          const note = p.flashNote ?? -1;
          const idx = note >= 0 ? note : 0;
          const bw = layout.widths[idx];
          const bx = layout.xs[idx];
          ctx.fillStyle = `rgba(255,253,248,${a})`;
          ctx.beginPath();
          this.roundRect(ctx, bx - bw / 2 + 1, -10, bw - 2, 12, 5);
          ctx.fill();
        } else if (p.defId === 'bumper') {
          ctx.strokeStyle = `rgba(255,253,248,${a})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, 31, 0, TAU);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawMarble(
    ctx: CanvasRenderingContext2D,
    m: Marble,
    alpha: number,
    now: number,
    reduced: boolean
  ) {
    const type = MARBLE_BY_ID.get(m.typeId);
    if (!type) return;
    const x = m.awake ? lerp(m.px, m.x, alpha) : m.x;
    const y = m.awake ? lerp(m.py, m.y, alpha) : m.y;
    const sway = m.bubbled ? Math.sin(now * 0.003 + m.id) * 2.5 : 0;
    const bx = x + sway;
    const air = clamp(m.airTime ?? 0, 0, 1.6);
    const lift = Math.min(1, air / 1.15);

    // Sombra proyectada: se separa y se aclara cuando la canica va por el aire.
    if (!m.bubbled && this.level < 2) {
      drawSoftShadow(
        ctx,
        x + 3.5 + lift * 7,
        y + 6 + lift * 10,
        m.r * 1.75 + lift * 2.6,
        m.r * 0.92 + lift * 1.5,
        0.48 * (1 - lift * 0.5)
      );
    }

    const speed = Math.hypot(m.vx, m.vy);
    if (!reduced && speed > 760) {
      // Motion blur barato: estelas de la propia esfera.
      const t = clamp((speed - 760) / 1400, 0, 1);
      for (let i = 3; i >= 1; i--) {
        const back = 0.011 * i;
        drawMarbleSprite(
          ctx,
          type,
          bx - m.vx * back,
          y - m.vy * back,
          m.r * (1 + lift * 0.1),
          (0.16 - i * 0.035) * t
        );
      }
    }

    if (type.premium && m.trail.length >= 4) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = m.trail;
      for (let i = 0; i < pts.length - 2; i += 2) {
        const t = 1 - i / Math.max(2, pts.length);
        ctx.strokeStyle = rgba(type.glow ?? type.color, 0.16 * t);
        ctx.lineWidth = m.r * 1.7 * t;
        ctx.beginPath();
        ctx.moveTo(pts[i], pts[i + 1]);
        ctx.lineTo(pts[i + 2], pts[i + 3]);
        ctx.stroke();
      }
    }

    if (type.premium) {
      const glow = 0.12 + 0.05 * Math.sin(now * 0.004 + m.id);
      ctx.fillStyle = rgba(type.glow ?? type.color, glow);
      ctx.beginPath();
      ctx.arc(bx, y, m.r * (2.4 + lift * 0.4), 0, TAU);
      ctx.fill();
    }

    const age = now - m.bornAt;
    const grow = age >= 0 && age < 90 ? 0.35 + 0.65 * (age / 90) : 1;
    const rideScale = m.ridePiece ? m.rideScale : 1;
    // Al ir por el aire se agranda un poco: lee como altura, no como escala.
    const airScale = 1 + lift * (0.1 + Math.min(0.08, air * 0.1));
    drawMarbleSprite(ctx, type, bx, y, m.r * grow * rideScale * airScale);
    if (m.bubbled) {
      const pulse = 1 + 0.02 * Math.sin(now * 0.004 + m.id);
      drawBubbleSprite(ctx, bx, y, m.r * 1.72 * pulse, 0.95);
      drawBubbleSprite(ctx, bx - m.r * 1.25, y - m.r * 0.8, m.r * 0.22, 0.45);
      drawBubbleSprite(ctx, bx + m.r * 1.2, y - m.r * 1.1, m.r * 0.15, 0.35);
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D, p: Piece, zoom: number) {
    const hs = pieceHitSize(p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.setLineDash([7 / zoom, 5 / zoom]);
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = rgba(this.theme.ink, 0.55);
    ctx.strokeRect(-hs.w / 2 - 5, -hs.h / 2 - 5, hs.w + 10, hs.h + 10);
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawDropPreview(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, zoom: number) {
    ctx.save();
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    ctx.strokeStyle = rgba(this.theme.ink, 0.25);
    ctx.lineWidth = 1.4 / zoom;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 110);
    ctx.lineTo(p.x, p.y - 18);
    ctx.stroke();
    ctx.setLineDash([]);
    const type = MARBLE_BY_ID.get(this.game.selectedMarble);
    if (type) drawMarbleSprite(ctx, type, p.x, p.y, type.r, 0.55);
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, now: number) {
    for (const p of this.game.particles) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = Math.min(1, p.alpha) * (0.35 + t * 0.65);
      ctx.fillStyle = p.color;
      if (p.kind === 1) {
        this.spark(ctx, p.x, p.y, p.size * (0.7 + t * 0.8), p.color);
      } else if (p.kind === 2) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.kind === 3) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + t * 0.5), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPopups(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const p of this.game.popups) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      const alpha = Math.min(1, t * 2.6);
      const scale = 1 + (1 - t) * 0.12;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.scale(scale, scale);
      ctx.font = '800 18px ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif';
      const tw = ctx.measureText(p.text).width;
      const total = tw + 16;
      ctx.translate(-total / 2, 0);
      this.spark(ctx, 5, 0, 6.5, PALETTE.yellow);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = PALETTE.paper;
      ctx.strokeText(p.text, 15, 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 15, 1);
      ctx.restore();
    }
  }

  private spark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color = PALETTE.yellow) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.32;
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    ctx.lineTo(x + rad, y + h);
    ctx.arcTo(x, y + h, x, y + h - rad, rad);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.closePath();
  }

  private checkQuality(now: number) {
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 0 && dt < 200) this.avgFrame = this.avgFrame * 0.92 + dt * 0.08;
    if (this.qualitySetting !== 'auto') return;
    if (now - this.lastCheck < 2200) return;
    this.lastCheck = now;
    if (this.avgFrame > 30 && this.level < 2) {
      this.setLevel(this.level + 1);
    } else if (this.avgFrame > 22 && this.level < 1) {
      this.setLevel(this.level + 1);
    } else if (this.avgFrame < 14.5 && this.level > 0) {
      this.setLevel(this.level - 1);
    }
  }
}
