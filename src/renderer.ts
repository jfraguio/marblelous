import type { Game } from './game';
import type { Marble, Piece } from './types';
import {
  drawMarbleSprite,
  drawPiece,
  getPieceSprite,
  PAD,
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
import { clamp, lerp, rgba, TAU } from './util';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: Game;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private level = 0;
  private qualitySetting = 'auto';
  private avgFrame = 16.7;
  private lastFrame = 0;
  private lastCheck = 0;

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
    const zoom = cam.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, w, h);

    // visible world rect
    const minX = cam.x - w / 2 / zoom - 80;
    const maxX = cam.x + w / 2 / zoom + 80;
    const minY = cam.y - h / 2 / zoom - 80;
    const maxY = cam.y + h / 2 / zoom + 80;

    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (w / 2 - cam.x * zoom) * dpr, (h / 2 - cam.y * zoom) * dpr);
    this.drawGrid(minX, maxX, minY, maxY, zoom);

    for (const p of g.pieces) {
      if (p.x < minX - 420 || p.x > maxX + 420 || p.y < minY - 420 || p.y > maxY + 420) continue;
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
      ctx.strokeStyle = rgba(PALETTE.ink, 0.35);
      ctx.lineWidth = 1.6 / zoom;
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      const hs = pieceHitSize(temp);
      ctx.strokeRect(-hs.w / 2, -hs.h / 2, hs.w, hs.h);
      ctx.restore();
    }

    for (const m of g.marbles) {
      if (!m.alive) continue;
      if (m.x < minX || m.x > maxX || m.y < minY || m.y > maxY) continue;
      this.drawMarble(ctx, m, alpha, now);
    }

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
        drawMarbleSprite(ctx, type, g.ghost.x, g.ghost.y, type.r * 1.15, 0.6);
      }
    }
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
    ctx.fillStyle = 'rgba(220,214,200,0.62)';
    const size = 2.3;
    for (let x = startX; x <= maxX; x += step) {
      for (let y = startY; y <= maxY; y += step) {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }

  private drawWorldPiece(ctx: CanvasRenderingContext2D, p: Piece, now: number, zoom: number) {
    if ((p.defId === 'star' || p.defId === 'bubble') && p.disabledUntil && p.disabledUntil > now) return;
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
    if (def.id === 'trampoline' && p.anim) {
      const age = (now - p.anim) / 1000;
      if (age >= 0 && age < 0.22) {
        const k = Math.exp(-age * 18);
        ctx.scale(1 + 0.06 * k, 1 - 0.14 * k);
      }
    }
    if (def.id === 'goal' && p.anim) {
      const age = (now - p.anim) / 1000;
      if (age >= 0 && age < 0.7) {
        ctx.rotate(Math.sin(age * 28) * 0.075 * Math.exp(-age * 3.2));
      }
    }

    drawPiece(ctx, p);

    if (p.defId === 'conveyor') {
      const offset = (now * 0.07) % 54;
      ctx.strokeStyle = 'rgba(255,253,248,0.38)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        const x = -80 + ((i * 54 + offset) % 160);
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

    if (p.defId === 'magnet') {
      const pulse = 0.06 + 0.035 * Math.sin(now * 0.0035);
      ctx.strokeStyle = rgba(PALETTE.red, pulse);
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 118 + i * 24 + Math.sin(now * 0.002 + i) * 3, 0, TAU);
        ctx.stroke();
      }
    }

    if (p.defId === 'star' && (!p.disabledUntil || p.disabledUntil < now)) {
      const pulse = 0.09 + 0.05 * Math.sin(now * 0.005);
      ctx.fillStyle = rgba(PALETTE.yellow, pulse);
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(now * 0.005) * 2, 0, TAU);
      ctx.fill();
    }

    if (p.defId === 'bubble') {
      const n = Math.min(10, p.charge ?? 0);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < n ? 'rgba(233,180,76,0.95)' : 'rgba(35,33,28,0.16)';
        ctx.beginPath();
        ctx.arc(-45 + i * 10, -24, 3, 0, TAU);
        ctx.fill();
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
        if (p.defId === 'xylo3' || p.defId === 'xylo5' || p.defId === 'xylo8') {
          const n = p.defId === 'xylo3' ? 3 : p.defId === 'xylo5' ? 5 : 8;
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

  private drawMarble(ctx: CanvasRenderingContext2D, m: Marble, alpha: number, now: number) {
    const type = MARBLE_BY_ID.get(m.typeId);
    if (!type) return;
    const x = m.awake ? lerp(m.px, m.x, alpha) : m.x;
    const y = m.awake ? lerp(m.py, m.y, alpha) : m.y;

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
      ctx.arc(x, y, m.r * 2.4, 0, TAU);
      ctx.fill();
    }

    const age = now - m.bornAt;
    const grow = age >= 0 && age < 90 ? 0.35 + 0.65 * (age / 90) : 1;
    const rideScale = m.ridePiece ? m.rideScale : 1;
    drawMarbleSprite(ctx, type, x, y, m.r * grow * rideScale);
  }

  private drawSelection(ctx: CanvasRenderingContext2D, p: Piece, zoom: number) {
    const hs = pieceHitSize(p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.setLineDash([7 / zoom, 5 / zoom]);
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = rgba(PALETTE.ink, 0.55);
    ctx.strokeRect(-hs.w / 2 - 5, -hs.h / 2 - 5, hs.w + 10, hs.h + 10);
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawDropPreview(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, zoom: number) {
    ctx.save();
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    ctx.strokeStyle = rgba(PALETTE.ink, 0.25);
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
        this.spark(ctx, p.x, p.y, p.size * (0.7 + t * 0.8));
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
