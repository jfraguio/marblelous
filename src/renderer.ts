import type { Game } from './game';
import type { Marble, Piece } from './types';
import {
  drawBubbleSprite,
  drawMarbleSprite,
  drawPiece,
  drawPieceFront,
  drawSoftShadow,
  getPieceShadow,
  LIGHT_X,
  LIGHT_Y,
  setSpriteBudget,
  setSpriteScale
} from './art';
import {
  MARBLE_BY_ID,
  NOTE_COLORS,
  PALETTE,
  FACTORY_LAMP,
  FACTORY_OUTLET,
  getPieceDef,
  pieceHitSize,
  pieceLength,
  spiralLocal,
  xyloLayout
} from './pieces';
import { clamp, hash2, lerp, makeCanvas, prefersReducedMotion, rgba, TAU, CAMERA_TILT } from './util';
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

const SHADOW_OFF_X = -LIGHT_X * 6;
const SHADOW_OFF_Y = -LIGHT_Y * 8;
// Piezas que flotan o no tienen base sólida: mancha suave en vez de silueta.
const ELLIPSE_SHADOW = new Set(['portal', 'fan', 'star']);

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: Game;
  private theme = WORLD_THEMES[0];
  private background: HTMLCanvasElement | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private level = 1;
  private qualitySetting = 'auto';
  private avgFrame = 16.7;
  private avgRender = 0;
  private healthySince = 0;
  private spriteScale = 1.5;
  private lastFrame = 0;
  private lastCheck = 0;
  private lastRender = 0;
  private dust: Dust[] = [];
  private prevAir = new Map<number, number>();
  private visible: Piece[] = [];
  private sortedPieces: Piece[] = [];
  private lastPieceRevision = -1;
  private radiusByPiece = new Map<number, number>();
  private outside: Marble[] = [];
  private inside = new Map<number, Marble[]>();
  private marbleLists: Marble[][] = [];
  private lastEmptyView: { x: number; y: number; zoom: number; world: number; mode: Game['mode'] } | null = null;

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.canvas = canvas;
    this.game = game;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
    setSpriteScale(this.spriteScale);
    setSpriteBudget(108);
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
    setSpriteBudget(next === 2 ? 74 : next === 1 ? 108 : 145);
    this.game.audio.setVoiceLimit(next === 2 ? 8 : 14);
    this.resize(true);
  }

  getLevel() {
    return this.level;
  }

  private resize(force = false) {
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const cap = this.level === 0 ? 2 : this.level === 1 ? 1.5 : 1;
    const pixels = this.level === 0 ? 4_200_000 : 2_400_000;
    const dpr = Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(pixels / (cssW * cssH)));
    if (!force && cssW === this.width && cssH === this.height && Math.abs(dpr - this.dpr) < 0.01) return;
    if (cssW !== this.width || cssH !== this.height) this.background = null;
    this.lastEmptyView = null;
    this.width = cssW;
    this.height = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = this.level === 0 ? 'high' : 'low';
    this.game.setViewport(cssW, cssH);
  }

  render(alpha: number, now: number) {
    const g = this.game;
    if (this.qualitySetting !== g.settings.quality) {
      this.qualitySetting = g.settings.quality;
      this.healthySince = 0;
      this.setLevel(this.qualitySetting === 'high' ? 0 : this.qualitySetting === 'low' ? 2 : 1);
    }
    this.checkQuality(now);
    if (this.level === 2 && now - this.lastRender < 31.5) return;
    const cam = g.camera;
    const empty = !g.pieces.length && !g.marbles.length && !g.particles.length && !this.dust.length && !g.ghost && !g.dropPreview;
    const lastEmpty = this.lastEmptyView;
    if (empty && lastEmpty && lastEmpty.x === cam.x && lastEmpty.y === cam.y && lastEmpty.zoom === cam.zoom &&
        lastEmpty.world === g.activeWorld && lastEmpty.mode === g.mode) return;
    this.lastEmptyView = empty ? { ...cam, world: g.activeWorld, mode: g.mode } : null;
    const renderStart = performance.now();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const dpr = this.dpr;
    const reduced = prefersReducedMotion();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastRender) / 1000));
    this.lastRender = now;
    const zoom = cam.zoom;
    const theme = worldTheme(g.activeWorld);
    if (theme !== this.theme) {
      this.theme = theme;
      this.background = null;
    }

    // LOD: se hornea a la resolución real (zoom × DPR) y se sube de nivel con
    // histéresis, para no re-hornear sprites en cada frame de pinch.
    const needed = Math.min(this.level === 0 ? 2.5 : this.level === 1 ? 2 : 1, zoom * dpr);
    let targetScale = this.spriteScale;
    if (needed > targetScale + 0.22 || needed < targetScale * 0.74) {
      targetScale = Math.max(1, Math.round(needed * 2) / 2);
    }
    if (targetScale !== this.spriteScale) {
      this.spriteScale = targetScale;
      setSpriteScale(targetScale);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.background ??= this.bakeBackground(w + 48, h + 40);
    const parallaxX = clamp(-cam.x * 0.014, -24, 24);
    const parallaxY = clamp(-cam.y * 0.012, -20, 20);
    ctx.drawImage(this.background, -24 + parallaxX, -20 + parallaxY, w + 48, h + 40);

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
    if (g.mode === 'build') this.drawGrid(minX, maxX, minY, maxY, zoom);

    // Orden por profundidad: lo que está más abajo se dibuja encima.
    // Solo se reordena cuando cambia el conjunto/posición de piezas.
    if (this.lastPieceRevision !== g.pieceRevision) {
      this.lastPieceRevision = g.pieceRevision;
      const sorted = this.sortedPieces;
      sorted.length = 0;
      this.radiusByPiece.clear();
      for (const p of g.pieces) {
        sorted.push(p);
        const { w, h } = pieceHitSize(p);
        this.radiusByPiece.set(p.id, Math.hypot(w, h) / 2 + 40);
      }
      sorted.sort((a, b) => a.y - b.y);
    }
    const visible = this.visible;
    visible.length = 0;
    for (const p of this.sortedPieces) {
      if (p.disabledUntil && p.disabledUntil > now) continue;
      const r = this.radiusByPiece.get(p.id)!;
      if (p.x < minX - r || p.x > maxX + r || p.y < minY - r || p.y > maxY + r) continue;
      visible.push(p);
    }

    // Sombra de contacto de todas las piezas (debajo de todas).
    if (this.level < 2) {
      for (const p of visible) this.drawPieceShadow(ctx, p);
    }

    this.outside.length = 0;
    for (const list of this.inside.values()) {
      list.length = 0;
      this.marbleLists.push(list);
    }
    this.inside.clear();
    for (const m of g.marbles) {
      if (!m.alive || m.x < minX || m.x > maxX || m.y < minY || m.y > maxY) continue;
      const x = m.awake ? lerp(m.px, m.x, alpha) : m.x;
      const y = m.awake ? lerp(m.py, m.y, alpha) : m.y;
      const channel = m.channelRide;
      if (channel && channel.slot > 4 && !channel.releasing) continue;
      const vessel = channel?.pieceId ?? m.fanRide?.pieceId ?? (m.bubbled || m.ridePiece ? 0 : g.physics.funnelAt(x, y, m.r));
      if (vessel && this.radiusByPiece.has(vessel)) {
        let list = this.inside.get(vessel);
        if (!list) {
          list = this.marbleLists.pop() ?? [];
          this.inside.set(vessel, list);
        }
        list.push(m);
      } else {
        this.outside.push(m);
      }
    }
    for (const p of visible) {
      const inside = this.inside.get(p.id);
      this.drawWorldPiece(ctx, p, now, reduced, !inside);
      if (!inside) continue;
      for (const m of inside) this.drawMarble(ctx, m, alpha, now, reduced, true);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.rot) ctx.rotate(p.rot);
      drawPieceFront(ctx, p);
      ctx.restore();
    }

    // ghost piece under marbles
    if (g.ghost) {
      const temp = g.ghost;
      ctx.save();
      ctx.globalAlpha = g.snap ? 0.77 : 0.52;
      ctx.translate(temp.x, temp.y);
      ctx.rotate(temp.rot);
      drawPiece(ctx, temp);
      ctx.restore();
      this.drawSelection(ctx, temp, zoom);
    }

    for (const m of this.outside) {
      if (this.level === 0) this.landingDust(m, reduced);
      this.drawMarble(ctx, m, alpha, now, reduced);
    }
    if (this.prevAir.size > 400) this.prevAir.clear();
    this.updateDust(dt);
    this.drawDust(ctx);

    this.drawParticles(ctx, now);

    if (g.selectedPieceId && !g.ghost) {
      const p = g.selectedPiece;
      if (p) this.drawSelection(ctx, p, zoom);
    }
    if (g.workshop.intro === 'edit' && !g.selectedPieceId && g.mode === 'build') {
      const channel = visible.find((piece) => piece.defId === 'sTrack');
      if (channel) this.drawSelection(ctx, channel, zoom);
    }

    if (g.dropPreview) {
      this.drawDropPreview(ctx, g.dropPreview, zoom);
    }

    if (g.snap) this.drawJoint(ctx, g.snap.jointX, g.snap.jointY, zoom, 0, 1);
    if (g.snapRipple && now - g.snapRipple.at < 310) {
      const age = (now - g.snapRipple.at) / 310;
      this.drawJoint(ctx, g.snapRipple.x, g.snapRipple.y, zoom, reduced ? 0 : age, 1 - age);
    }
    this.avgRender = lerp(this.avgRender, performance.now() - renderStart, 0.08);
  }

  private bakeBackground(w: number, h: number): HTMLCanvasElement {
    const scale = Math.min(1, 1200 / Math.max(w, h));
    const canvas = makeCanvas(w * scale, h * scale);
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.scale(canvas.width / w, canvas.height / h);
    const wash = ctx.createLinearGradient(0, 0, w * 0.24, h);
    wash.addColorStop(0, this.theme.paper);
    wash.addColorStop(1, this.theme.paper2);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    this.paintBackdrop(ctx, w, h);
    return canvas;
  }

  /** Fondo de estudio: charco de luz y penumbra con parallax leve. */
  private paintBackdrop(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number
  ) {
    const theme = this.theme;
    const space = theme.kind === 'space';
    const volcano = theme.kind === 'volcano';
    const warm = space ? '120,150,255' : volcano ? '255,120,50' : '255,252,242';

    const g1 = ctx.createRadialGradient(w * 0.26, h * 0.1, 0, w * 0.26, h * 0.1, Math.max(w, h) * 0.95);
    g1.addColorStop(0, theme.light);
    g1.addColorStop(0.55, `rgba(${warm},${space ? 0.045 : volcano ? 0.07 : 0.09})`);
    g1.addColorStop(1, `rgba(${warm},0)`);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(
      w * 0.82,
      h * 0.92,
      0,
      w * 0.82,
      h * 0.92,
      Math.max(w, h) * 0.85
    );
    g2.addColorStop(0, theme.shade);
    g2.addColorStop(1, space ? 'rgba(0,0,0,0)' : 'rgba(35,33,28,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    this.drawWorldDecor(ctx, w, h);
  }

  private drawWorldDecor(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number
  ) {
    const kind = this.theme.kind;
    // Una sola composición por fondo; el paralaje desplaza la imagen completa.
    const now = 28000;
    const pulse = 0.5;
    const ox = 0;
    const oy = 0;

    if (kind === 'garden') {
      ctx.fillStyle = 'rgba(255,232,177,0.64)';
      ctx.beginPath();
      ctx.arc(w * 0.77, h * 0.21, Math.min(w, h) * 0.085, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        const base = h * (0.73 + i * 0.09);
        ctx.fillStyle = ['#CEDBC5', '#BFD4BA', '#B3CBB0'][i];
        ctx.beginPath();
        ctx.moveTo(-2, h);
        ctx.lineTo(-2, base);
        ctx.bezierCurveTo(w * 0.25, base - h * 0.21, w * 0.56, base + h * 0.17, w + 2, base - h * 0.09);
        ctx.lineTo(w + 2, h);
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < 21; i++) {
        const seed = hash2(i + 8, 41);
        const t = (seed % 1000) / 1000;
        const x = w * t;
        const ground = h * (0.91 + 0.09 * ((seed >>> 12) % 17) / 17);
        const height = 22 + ((seed >>> 18) % 77);
        const bend = i % 2 ? -13 : 13;
        ctx.strokeStyle = 'rgba(65,118,87,0.31)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, ground);
        ctx.quadraticCurveTo(x + bend * 0.35, ground - height * 0.58, x + bend, ground - height);
        ctx.stroke();
        ctx.fillStyle = i % 4 ? 'rgba(70,126,91,0.24)' : 'rgba(214,154,86,0.44)';
        ctx.beginPath();
        ctx.ellipse(x + bend, ground - height, 4, 8, bend * 0.022, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x - bend / 3, ground - height * 0.47, 7, 3, bend * 0.045, 0, TAU);
        ctx.fill();
      }
      return;
    }

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
      const wide = hs.w * 0.58;
      const tall = p.defId === 'fan' ? 140 : Math.max(14, hs.h * 0.46);
      drawSoftShadow(ctx, p.x + SHADOW_OFF_X * 0.8, p.y + SHADOW_OFF_Y * 0.9, wide, tall, 0.26);
      return;
    }
    const sh = getPieceShadow(p);
    ctx.save();
    ctx.translate(p.x + SHADOW_OFF_X, p.y + SHADOW_OFF_Y);
    if (p.rot) ctx.rotate(p.rot);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(sh.canvas, -sh.w / 2, -sh.h / 2, sh.w, sh.h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Polvo y mini onda al aterrizar una canica. */
  private landingDust(m: Marble, reduced: boolean) {
    if (reduced || this.dust.length > 84) return;
    const prev = this.prevAir.get(m.id) ?? 0;
    this.prevAir.set(m.id, m.airTime);
    if (prev < 0.32 || m.airTime > 0.001) return;
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
    const step = this.level === 2 ? 80 : 40;
    const startX = Math.floor(minX / step) * step;
    const startY = Math.floor(minY / step) * step;
    const maxDots = 4200;
    const n = ((maxX - minX) / step) * ((maxY - minY) / step);
    if (n > maxDots) return;
    ctx.fillStyle = this.theme.grid;
    const size = 1.8;
    ctx.beginPath();
    for (let x = startX; x <= maxX; x += step) {
      for (let y = startY; y <= maxY; y += step) {
        ctx.rect(x - size / 2, y - size / 2, size, size);
      }
    }
    ctx.fill();
  }

  private drawWorldPiece(ctx: CanvasRenderingContext2D, p: Piece, now: number, reduced: boolean, withFront: boolean) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.bornAt && !reduced && p.defId !== 'fan' && p.defId !== 'funnel') {
      const age = now - p.bornAt;
      if (age >= 0 && age < 150) {
        const s = 0.9 + 0.1 * (age / 150);
        ctx.scale(s, s);
      }
    }
    if (p.rot) ctx.rotate(p.rot);

    const def = getPieceDef(p.defId);
    if (def.id === 'goal' && p.anim && !reduced) {
      const age = (now - p.anim) / 1000;
      if (age >= 0 && age < 0.7) {
        ctx.rotate(Math.sin(age * 28) * 0.075 * Math.exp(-age * 3.2));
      }
    }
    if (def.id === 'bumper' && p.flash && !reduced) {
      const age = (now - p.flash) / 1000;
      if (age >= 0 && age < 0.24) {
        const k = Math.exp(-age * 17);
        ctx.scale(1 + 0.09 * k, 1 - 0.12 * k);
      }
    }
    if (def.id === 'bubble' && p.anim && !reduced) {
      ctx.translate(Math.sin(now * 0.09) * 1.6, 0);
    }

    drawPiece(ctx, p, withFront);

    if (def.id === 'electromagnet') {
      const attract = (p.polarity ?? 1) >= 0;
      const rgb = attract ? '46,158,151' : '217,93,57';
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.004);
      ctx.strokeStyle = `rgba(${rgb},${0.14 + 0.12 * pulse})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = reduced ? 0 : (attract ? -now : now) * 0.03;
      ctx.beginPath();
      ctx.arc(0, 0, 150, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = `rgba(${rgb},0.52)`;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < (this.level === 2 ? 2 : 4); i++) {
        const a = (reduced ? 0 : now * 0.0006) + (i * TAU) / 4;
        const r0 = attract ? 118 : 98;
        const r1 = attract ? 98 : 118;
        const x0 = Math.cos(a) * r0;
        const y0 = Math.sin(a) * r0;
        const x1 = Math.cos(a) * r1;
        const y1 = Math.sin(a) * r1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        const head = Math.atan2(y1 - y0, x1 - x0);
        ctx.lineTo(x1 - Math.cos(head - 0.5) * 8, y1 - Math.sin(head - 0.5) * 8);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(head + 0.5) * 8, y1 - Math.sin(head + 0.5) * 8);
        ctx.stroke();
      }
    }

    if (def.id === 'bubbleLift' && this.level < 2 && !reduced) {
      const k = 0.5 + 0.5 * Math.sin(now * 0.003);
      ctx.strokeStyle = `rgba(143,211,238,${0.12 + 0.12 * k})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, -8, 52 + k * 4, 52 + k * 4, 0, 0, TAU);
      ctx.stroke();
    }

    if (def.id === 'marbleFactory') {
      const on = p.powered !== false;
      const rgb = on ? '79,157,105' : '217,93,57';
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.006);
      if (on) {
        ctx.fillStyle = `rgba(${rgb},${0.14 + 0.14 * pulse})`;
        ctx.beginPath();
        ctx.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 16 + pulse * 3, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${rgb},${on ? 0.82 + pulse * 0.18 : 0.9})`;
      ctx.beginPath();
      ctx.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 5.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(FACTORY_LAMP.x - 1.4, FACTORY_LAMP.y - 1.6, 2.4, 0, TAU);
      ctx.stroke();
      if (p.anim && now - p.anim < 340) {
        const t = (now - p.anim) / 340;
        ctx.strokeStyle = `rgba(143,211,238,${(1 - t) * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          FACTORY_OUTLET.x,
          FACTORY_OUTLET.y - 8,
          9 + t * 12,
          3.5 + t * 5,
          0,
          0,
          TAU
        );
        ctx.stroke();
      }
    }

    if (p.defId === 'conveyor' && this.level === 0 && !reduced) {
      // Reflejo que recorre la cinta (las flechas ya van horneadas).
      const half = pieceLength(p) / 2;
      const span = Math.max(20, half * 2 - 20);
      const x = -half + 10 + ((now * 0.11) % span);
      const sheen = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.16)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(x - 30, -7, 60, 14);
    }

    if (p.defId === 'booster' && this.level < 2 && !reduced) {
      const pulse = 0.12 + 0.06 * Math.sin(now * 0.006);
      ctx.strokeStyle = rgba(PALETTE.teal, pulse);
      ctx.lineWidth = 2;
      this.roundRect(ctx, -45, -45, 90, 90, 22);
      ctx.stroke();
    }

    if (p.defId === 'star' && this.level < 2 && !reduced) {
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

    if (p.defId === 'portal' && this.level < 2 && !reduced) {
      const half = pieceLength(p) / 2;
      for (const x of [-half, half]) {
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
      const off = reduced ? 0 : (now * 0.049) % 58;
      const glow = p.flash ? clamp(1 - (now - p.flash) / 520, 0, 1) : 0;
      ctx.strokeStyle = `rgba(242,255,253,${0.42 + glow * 0.43})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const y = 66 - (i * 58 + off);
        ctx.moveTo(-20, y + 5);
        ctx.quadraticCurveTo(0, y - 12, 20, y + 5);
      }
      ctx.stroke();
      if (glow) {
        ctx.fillStyle = `rgba(176,243,216,${glow * 0.42})`;
        ctx.beginPath();
        ctx.ellipse(0, 97, 40, 7, 0, 0, TAU);
        ctx.fill();
      }
    }

    if (p.defId === 'meter' || p.defId === 'splitter') {
      const lit = p.flash !== undefined && now - p.flash < 180;
      const x = p.defId === 'meter' ? 42 : 29;
      const dots = p.defId === 'meter' ? 3 : 1;
      for (let i = 0; i < dots; i++) {
        ctx.fillStyle = lit ? '#D8FFDD' : i <= p.variant ? '#90D2C0' : '#65838C';
        ctx.beginPath();
        ctx.arc(x, -39 + i * 12, 3.2, 0, TAU);
        ctx.fill();
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
    reduced: boolean,
    inside = false
  ) {
    const type = MARBLE_BY_ID.get(m.typeId);
    if (!type) return;
    const x = m.awake ? lerp(m.px, m.x, alpha) : m.x;
    const y = m.awake ? lerp(m.py, m.y, alpha) : m.y;
    const sway = m.bubbled && !reduced ? Math.sin(now * 0.003 + m.id) * 2.5 : 0;
    const bx = x + sway;
    const air = clamp(m.airTime ?? 0, 0, 1.6);
    const lift = Math.min(1, air / 1.15);

    // Sombra proyectada: se separa y se aclara cuando la canica va por el aire.
    if (!inside && !m.bubbled && this.level < 2) {
      drawSoftShadow(
        ctx,
        x + 3.5 + lift * 7,
        y + 6 + lift * 10,
        m.r * 1.75 + lift * 2.6,
        m.r * 0.92 + lift * 1.5,
        0.48 * (1 - lift * 0.5)
      );
    }

    if (!inside && !reduced && this.level === 0 && m.vx * m.vx + m.vy * m.vy > 760 ** 2) {
      // Motion blur barato: estelas de la propia esfera.
      const speed = Math.hypot(m.vx, m.vy);
      const t = clamp((speed - 760) / 1400, 0, 1);
      for (let i = 2; i >= 1; i--) {
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

    if (!inside && !reduced && this.level < 2 && type.premium && m.trail.length >= 4) {
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

    if (!inside && this.level < 2 && type.premium) {
      const glow = 0.12 + 0.05 * Math.sin(now * 0.004 + m.id);
      ctx.fillStyle = rgba(type.glow ?? type.color, glow);
      ctx.beginPath();
      ctx.arc(bx, y, m.r * (2.4 + lift * 0.4), 0, TAU);
      ctx.fill();
    }

    const age = now - m.bornAt;
    const grow = !reduced && age >= 0 && age < 90 ? 0.45 + 0.55 * (age / 90) : 1;
    const rideScale = m.ridePiece ? m.rideScale : 1;
    // Al ir por el aire se agranda un poco: lee como altura, no como escala.
    const airScale = inside || reduced ? 1 : 1 + lift * 0.065;
    drawMarbleSprite(ctx, type, bx, y, m.r * grow * rideScale * airScale);
    if (m.bubbled) {
      const pulse = reduced ? 1 : 1 + 0.02 * Math.sin(now * 0.004 + m.id);
      drawBubbleSprite(ctx, bx, y, m.r * 1.72 * pulse, 0.95);
      if (this.level < 2) drawBubbleSprite(ctx, bx - m.r * 1.25, y - m.r * 0.8, m.r * 0.22, 0.45);
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
    ctx.moveTo(p.x, p.y + 26);
    ctx.lineTo(p.x, p.y + 105);
    ctx.stroke();
    ctx.setLineDash([]);
    const type = MARBLE_BY_ID.get(this.game.selectedMarble);
    if (type) drawMarbleSprite(ctx, type, p.x, p.y, type.r, 0.55);
    ctx.restore();
  }

  private drawJoint(ctx: CanvasRenderingContext2D, x: number, y: number, zoom: number, spread: number, opacity: number) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(x, y, (9 + spread * 15) / zoom, 0, TAU);
    ctx.strokeStyle = '#24485A';
    ctx.lineWidth = 4.5 / zoom;
    ctx.stroke();
    ctx.strokeStyle = '#CFF4DA';
    ctx.lineWidth = 2.5 / zoom;
    ctx.stroke();
    if (!spread) {
      ctx.beginPath();
      ctx.arc(x, y, 3 / zoom, 0, TAU);
      ctx.fillStyle = '#E7FFE8';
      ctx.fill();
    }
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
    if ((this.avgFrame > 24 || this.avgRender > 14) && this.level < 2) {
      this.setLevel(this.level + 1);
      this.healthySince = 0;
    } else if (this.avgFrame < 18.5 && this.avgRender < 6 && this.level > 0) {
      if (!this.healthySince) this.healthySince = now;
      if (now - this.healthySince > 6500) {
        this.setLevel(this.level - 1);
        this.healthySince = 0;
      }
    } else {
      this.healthySince = 0;
    }
  }
}
