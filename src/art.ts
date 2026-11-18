import type { MarbleType, Piece } from './types';
import {
  COLORS,
  FUNNEL_LEFT,
  FUNNEL_RIGHT,
  HALF_PIPE_RADIUS,
  LOOP_END,
  LOOP_RADIUS,
  LOOP_START,
  MARBLE_TYPES,
  NOTE_COLORS,
  PALETTE,
  RAMP_CURVE_END,
  RAMP_CURVE_RADIUS,
  RAMP_CURVE_START,
  SPIRAL_ENTRY,
  spiralDepth,
  spiralLocal,
  getPieceDef,
  xyloLayout
} from './pieces';
import { makeCanvas, rgba, shade, TAU } from './util';

export const PAD = 14;
export const SPRITE_SCALE = 2;

export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const cache = new Map<string, Sprite>();
const marbleCache = new Map<string, Sprite>();
const shadowCache = new Map<string, Sprite>();
let cacheBudget = 140;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
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

const EXTRUDE_X = 5;
const EXTRUDE_Y = 6;
const EXTRUDE_STEPS = 8;

/**
 * Dirección de la luz de estudio (desde la escena hacia la fuente): arriba a la
 * izquierda. Todos los volúmenes y sombras de la escena la comparten.
 */
export const LIGHT_X = -0.56;
export const LIGHT_Y = -0.83;

/** Silueta plana del arte, tintada. */
function silhouette(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/**
 * Desenfoque barato y compatible con Safari antiguo: reducir y volver a
 * ampliar con suavizado. Se usa solo al hornear sprites, nunca por frame.
 */
function blurCanvas(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const small = makeCanvas(Math.max(1, src.width / factor), Math.max(1, src.height / factor));
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(src, 0, 0, small.width, small.height);
  const out = makeCanvas(src.width, src.height);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function makeSprite(
  worldW: number,
  worldH: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  extrude = true,
  sideColor = '#2B2A26'
): Sprite {
  const w = Math.max(1, worldW + PAD * 2);
  const h = Math.max(1, worldH + PAD * 2);
  const art = makeCanvas(w * SPRITE_SCALE, h * SPRITE_SCALE);
  const actx = art.getContext('2d')!;
  actx.scale(SPRITE_SCALE, SPRITE_SCALE);
  actx.translate(w / 2, h / 2);
  draw(actx);
  if (!extrude) return { canvas: art, w, h };

  const canvas = makeCanvas(art.width, art.height);
  const ctx = canvas.getContext('2d')!;
  const sil = silhouette(art, sideColor);

  // Oclusión ambiental horneada: halo suave bajo el cuerpo, desplazado hacia
  // donde cae la sombra. Da asiento a la pieza sin coste por frame.
  const ao = blurCanvas(silhouette(art, 'rgba(35,33,28,0.55)'), 4);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(ao, 1.5 * SPRITE_SCALE, 2.8 * SPRITE_SCALE);
  ctx.restore();

  for (let i = EXTRUDE_STEPS; i >= 1; i--) {
    const t = i / EXTRUDE_STEPS;
    ctx.drawImage(sil, EXTRUDE_X * t * SPRITE_SCALE, EXTRUDE_Y * t * SPRITE_SCALE);
  }
  ctx.drawImage(art, 0, 0);

  // Luz direccional horneada: canto superior iluminado, base en penumbra.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const light = ctx.createLinearGradient(0, 0, canvas.width * 0.62, canvas.height);
  light.addColorStop(0, 'rgba(255,255,255,0.20)');
  light.addColorStop(0.38, 'rgba(255,255,255,0.03)');
  light.addColorStop(0.72, 'rgba(35,33,28,0.035)');
  light.addColorStop(1, 'rgba(35,33,28,0.15)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  return { canvas, w, h };
}

export function clearSpriteCache() {
  cache.clear();
  marbleCache.clear();
  shadowCache.clear();
}

export function setSpriteBudget(n: number) {
  cacheBudget = Math.max(40, n);
}

function trimCache() {
  while (cache.size > cacheBudget) {
    const key = cache.keys().next().value as string | undefined;
    if (key === undefined) break;
    cache.delete(key);
  }
  while (shadowCache.size > cacheBudget) {
    const key = shadowCache.keys().next().value as string | undefined;
    if (key === undefined) break;
    shadowCache.delete(key);
  }
}

function colorFor(p: Piece): string {
  const d = getPieceDef(p.defId);
  if (p.defId === 'xylo3' || p.defId === 'xylo5' || p.defId === 'xylo8') return PALETTE.wood;
  if (p.defId === 'loop') return PALETTE.red;
  if (p.defId === 'trampoline') return PALETTE.green;
  if (p.defId === 'conveyor') return PALETTE.steel;
  if (p.defId === 'bumper') return PALETTE.red;
  if (p.defId === 'booster') return PALETTE.teal;
  if (p.defId === 'cannon') return PALETTE.purple;
  if (p.defId === 'goal') return PALETTE.yellow;
  if (p.defId === 'star') return PALETTE.yellow;
  if (p.defId === 'magnet') return PALETTE.red;
  if (p.defId === 'spiral') return PALETTE.teal;
  if (p.defId === 'bubble') return '#8FD3EE';
  if (p.defId === 'portal') return PALETTE.purple;
  if (p.defId === 'fan') return PALETTE.teal;
  if (d.tintable) return COLORS[p.color] ?? COLORS[d.defaultColor] ?? PALETTE.blue;
  return COLORS[d.defaultColor] ?? PALETTE.blue;
}

function spriteDims(p: Piece): { w: number; h: number } {
  switch (p.defId) {
    case 'ramp':
      return { w: p.len + 16, h: 26 };
    case 'loop':
      return { w: LOOP_RADIUS * 2 + 14, h: LOOP_RADIUS * 2 + 14 };
    case 'rampCurve':
      return { w: RAMP_CURVE_RADIUS * 2 + 18, h: RAMP_CURVE_RADIUS * 2 + 18 };
    case 'halfPipe':
      return { w: HALF_PIPE_RADIUS * 2 + 18, h: HALF_PIPE_RADIUS * 2 + 18 };
    case 'funnel':
      return { w: 200, h: 170 };
    case 'xylo3':
    case 'xylo5':
    case 'xylo8': {
      const n = p.defId === 'xylo3' ? 3 : p.defId === 'xylo5' ? 5 : 8;
      const l = xyloLayout(n);
      return { w: l.total + 24, h: 62 };
    }
    case 'magnet':
      return { w: 360, h: 360 };
    case 'spiral':
      return { w: 300, h: 330 };
    case 'bubble':
      return { w: 228, h: 44 };
    case 'portal':
      return { w: 260, h: 120 };
    case 'fan':
      return { w: 124, h: 232 };
    case 'goal':
      return { w: 126, h: 126 };
    case 'star':
      return { w: 54, h: 54 };
    case 'bumper':
      return { w: 64, h: 64 };
    case 'booster':
      return { w: 84, h: 84 };
    case 'cannon':
      return { w: 104, h: 70 };
    case 'conveyor':
      return { w: 168, h: 28 };
    case 'trampoline':
      return { w: 128, h: 28 };
    case 'plate4':
      return { w: 168, h: 34 };
    default:
      return { w: getPieceDef(p.defId).w, h: getPieceDef(p.defId).h };
  }
}

export function getPieceSprite(p: Piece): Sprite {
  const key = `${p.defId}|${p.color}|${p.len}|${p.variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dims = spriteDims(p);
  const s = buildPieceSprite(p, dims.w, dims.h);
  cache.set(key, s);
  trimCache();
  return s;
}

export function drawPiece(ctx: CanvasRenderingContext2D, p: Piece) {
  const s = getPieceSprite(p);
  ctx.drawImage(s.canvas, -s.w / 2, -s.h / 2, s.w, s.h);
}

/**
 * Sombra de contacto de una pieza: su silueta desenfocada. Se hornea una vez
 * por variante y se dibuja antes de las piezas.
 */
export function getPieceShadow(p: Piece): Sprite {
  const key = `${p.defId}|${p.color}|${p.len}|${p.variant}`;
  const hit = shadowCache.get(key);
  if (hit) return hit;
  const s = getPieceSprite(p);
  const soft = blurCanvas(silhouette(s.canvas, '#23211C'), 6);
  const shadow = { canvas: soft, w: s.w, h: s.h };
  shadowCache.set(key, shadow);
  trimCache();
  return shadow;
}

let blob: Sprite | null = null;

/** Mancha de sombra difusa reutilizable (canicas, piezas de efecto). */
export function getSoftShadow(): Sprite {
  if (blob) return blob;
  const size = 64;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(35,33,28,0.62)');
  g.addColorStop(0.5, 'rgba(35,33,28,0.3)');
  g.addColorStop(1, 'rgba(35,33,28,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  blob = { canvas: c, w: size, h: size };
  return blob;
}

export function drawSoftShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number
) {
  if (rx <= 0 || ry <= 0 || alpha <= 0) return;
  const s = getSoftShadow();
  ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = 1;
}

function buildPieceSprite(p: Piece, ww: number, hh: number): Sprite {
  const base = colorFor(p);
  const noExtrude = p.defId === 'spiral';
  return makeSprite(ww, hh, (ctx) => {
    const c = base;
    const dark = shade(c, -0.18);
    const light = shade(c, 0.22);
    const ink = rgba(PALETTE.ink, 0.16);

    const body = (w: number, h: number, rad: number, y = 0) => {
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -w / 2 + 1, -h / 2 + 4 + y, w, h, rad);
      ctx.fill();
      ctx.fillStyle = c;
      rr(ctx, -w / 2, -h / 2 + y, w, h, rad);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.32);
      ctx.lineWidth = 1.5;
      rr(ctx, -w / 2 + 3, -h / 2 + y + 2.4, w - 6, Math.max(2, h - 6), Math.max(1, rad - 2));
      ctx.stroke();
      ctx.fillStyle = rgba(PALETTE.ink, 0.12);
      rr(ctx, -w / 2 + 3, h / 2 + y - 5, w - 6, 3, 2);
      ctx.fill();
    };

    const studs = (count: number, spacing: number, rad: number, y: number) => {
      const start = -((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const x = start + i * spacing;
        ctx.fillStyle = PALETTE.shadow;
        ctx.beginPath();
        ctx.arc(x + 1, y + 3, rad, 0, TAU);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = dark;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffffff', 0.4);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x - rad * 0.18, y - rad * 0.16, rad * 0.56, Math.PI * 0.9, Math.PI * 1.9);
        ctx.stroke();
      }
    };

    if (p.defId === 'brick2' || p.defId === 'brick4') {
      const w = p.defId === 'brick2' ? 80 : 160;
      const count = p.defId === 'brick2' ? 2 : 4;
      studs(count, 40, 11.5, -20 + 2);
      body(w, 40, 6);
    } else if (p.defId === 'plate4') {
      const w = 160;
      studs(4, 40, 8.5, -10 + 2);
      body(w, 20, 5);
    } else if (p.defId === 'ramp') {
      const L = p.len;
      ctx.strokeStyle = PALETTE.shadow;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 2, 4);
      ctx.lineTo(L / 2 + 2, 4);
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0);
      ctx.lineTo(L / 2, 0);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.strokeStyle = light;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 3, -3.5);
      ctx.lineTo(L / 2 - 3, -3.5);
      ctx.stroke();
    } else if (p.defId === 'rampCurve') {
      const track = (r: number, lw: number, col: string) => {
        ctx.beginPath();
        ctx.arc(0, 0, r, RAMP_CURVE_START, RAMP_CURVE_END);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(1.5, 3);
      track(RAMP_CURVE_RADIUS, 13, PALETTE.shadow);
      ctx.restore();
      track(RAMP_CURVE_RADIUS, 16, dark);
      track(RAMP_CURVE_RADIUS, 12, c);
      track(RAMP_CURVE_RADIUS - 4.2, 2.1, rgba('#ffffff', 0.35));
    } else if (p.defId === 'halfPipe') {
      const track = (r: number, lw: number, col: string) => {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(1.5, 3);
      track(HALF_PIPE_RADIUS, 13, PALETTE.shadow);
      ctx.restore();
      track(HALF_PIPE_RADIUS, 16, dark);
      track(HALF_PIPE_RADIUS, 12, c);
      track(HALF_PIPE_RADIUS + 4.2, 2.0, rgba('#ffffff', 0.3));
    } else if (p.defId === 'loop') {
      const track = (r: number, lw: number, col: string) => {
        ctx.beginPath();
        ctx.arc(0, 0, r, LOOP_START, LOOP_END);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(1.5, 3);
      track(LOOP_RADIUS, 10, PALETTE.shadow);
      ctx.restore();
      track(LOOP_RADIUS, 13, shade(PALETTE.red, -0.2));
      track(LOOP_RADIUS, 9, PALETTE.red);
      track(LOOP_RADIUS - 3.2, 1.8, rgba('#ffffff', 0.38));
      // entry chevron
      ctx.save();
      ctx.translate(Math.cos((52 * Math.PI) / 180) * (LOOP_RADIUS + 9), Math.sin((52 * Math.PI) / 180) * (LOOP_RADIUS + 9));
      ctx.rotate(0.4);
      ctx.strokeStyle = rgba(PALETTE.ink, 0.5);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-7, -5);
      ctx.lineTo(0, 0);
      ctx.lineTo(-7, 5);
      ctx.stroke();
      ctx.restore();
    } else if (p.defId === 'funnel') {
      const drawCurve = (pts: { x: number; y: number }[], col: string, off = 0) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x + off, pts[0].y + off);
        for (const pt of pts.slice(1)) ctx.lineTo(pt.x + off, pt.y + off);
        ctx.strokeStyle = col;
        ctx.lineWidth = 13;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(1.5, 3);
      drawCurve(FUNNEL_LEFT, PALETTE.shadow);
      drawCurve(FUNNEL_RIGHT, PALETTE.shadow);
      ctx.restore();
      drawCurve(FUNNEL_LEFT, dark);
      drawCurve(FUNNEL_RIGHT, dark);
      ctx.lineWidth = 9;
      drawCurve(FUNNEL_LEFT, c);
      drawCurve(FUNNEL_RIGHT, c);
      ctx.strokeStyle = rgba('#ffffff', 0.3);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(FUNNEL_LEFT[1].x - 2, FUNNEL_LEFT[1].y);
      ctx.lineTo(FUNNEL_LEFT[FUNNEL_LEFT.length - 2].x - 2, FUNNEL_LEFT[FUNNEL_LEFT.length - 2].y);
      ctx.moveTo(FUNNEL_RIGHT[1].x + 2, FUNNEL_RIGHT[1].y);
      ctx.lineTo(FUNNEL_RIGHT[FUNNEL_RIGHT.length - 2].x + 2, FUNNEL_RIGHT[FUNNEL_RIGHT.length - 2].y);
      ctx.stroke();
    } else if (p.defId === 'trampoline') {
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -60, -6 + 4, 120, 16, 8);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.green, -0.25);
      rr(ctx, -62, -8, 124, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#7BC98F';
      rr(ctx, -56, -5, 112, 12, 6);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.55);
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 30, -3);
        ctx.lineTo(i * 30, 3);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(PALETTE.ink, 0.14);
      ctx.lineWidth = 1.4;
      rr(ctx, -62, -8, 124, 18, 9);
      ctx.stroke();
    } else if (p.defId === 'conveyor') {
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -78, -8 + 4, 156, 20, 7);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.steel, -0.3);
      rr(ctx, -80, -11, 160, 22, 8);
      ctx.fill();
      ctx.fillStyle = '#59636D';
      rr(ctx, -74, -6, 148, 12, 4);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.18);
      ctx.lineWidth = 1.4;
      rr(ctx, -80, -11, 160, 22, 8);
      ctx.stroke();
    } else if (p.defId === 'bumper') {
      ctx.fillStyle = PALETTE.shadow;
      ctx.beginPath();
      ctx.arc(1, 4, 30, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.red, -0.25);
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.red;
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.teal;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.55);
      ctx.beginPath();
      ctx.arc(-5, -6, 5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.2);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, TAU);
      ctx.stroke();
    } else if (p.defId === 'booster') {
      ctx.fillStyle = rgba(PALETTE.teal, 0.15);
      rr(ctx, -40, -40, 80, 80, 18);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.teal, 0.85);
      ctx.lineWidth = 2.2;
      rr(ctx, -40, -40, 80, 80, 18);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.teal;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const x = i * 18;
        ctx.beginPath();
        ctx.moveTo(x - 7, -11);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x - 7, 11);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(PALETTE.teal, 0.2);
      ctx.beginPath();
      ctx.arc(0, 0, 31, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'cannon') {
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -40, 4, 80, 20, 7);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.purple, -0.2);
      rr(ctx, -42, -6, 84, 22, 8);
      ctx.fill();
      ctx.fillStyle = PALETTE.purple;
      rr(ctx, -36, -10, 72, 20, 7);
      ctx.fill();
      // spring
      ctx.strokeStyle = shade(PALETTE.purple, 0.34);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const y = -14 - i * 6;
        ctx.beginPath();
        ctx.moveTo(-15, y);
        ctx.bezierCurveTo(-5, y - 4, 5, y + 4, 15, y);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba('#ffffff', 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -32);
      ctx.lineTo(0, -42);
      ctx.moveTo(-6, -36);
      ctx.lineTo(0, -42);
      ctx.lineTo(6, -36);
      ctx.stroke();
    } else if (p.defId === 'star') {
      star(ctx, 0, 0, 19, 9, PALETTE.yellow, PALETTE.ink);
      ctx.fillStyle = rgba('#ffffff', 0.5);
      ctx.beginPath();
      ctx.arc(-5, -6, 3.2, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'goal') {
      // stand shadow
      ctx.fillStyle = PALETTE.shadow;
      ctx.beginPath();
      ctx.ellipse(2, 40, 46, 10, 0, 0, TAU);
      ctx.fill();
      // bell body
      ctx.fillStyle = shade(PALETTE.yellow, -0.25);
      ctx.beginPath();
      ctx.moveTo(-42, 26);
      ctx.bezierCurveTo(-42, -12, -28, -40, 0, -40);
      ctx.bezierCurveTo(28, -40, 42, -12, 42, 26);
      ctx.quadraticCurveTo(0, 40, -42, 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PALETTE.yellow;
      ctx.beginPath();
      ctx.moveTo(-37, 22);
      ctx.bezierCurveTo(-37, -10, -24, -34, 0, -34);
      ctx.bezierCurveTo(24, -34, 37, -10, 37, 22);
      ctx.quadraticCurveTo(0, 34, -37, 22);
      ctx.closePath();
      ctx.fill();
      // opening
      ctx.fillStyle = '#6E5225';
      ctx.beginPath();
      ctx.ellipse(0, 23, 31, 9, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3A2A13';
      ctx.beginPath();
      ctx.ellipse(0, 23, 28, 6, 0, 0, TAU);
      ctx.fill();
      // rim
      ctx.strokeStyle = shade(PALETTE.yellow, 0.18);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 23, 35, 11, 0, 0, TAU);
      ctx.stroke();
      // clapper
      ctx.fillStyle = PALETTE.ink;
      ctx.beginPath();
      ctx.arc(0, 34, 5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.45);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(-16, -12, 17, Math.PI * 1.05, Math.PI * 1.55);
      ctx.stroke();
      // little handles
      ctx.fillStyle = shade(PALETTE.yellow, -0.1);
      ctx.beginPath();
      ctx.arc(-44, 18, 5, 0, TAU);
      ctx.arc(44, 18, 5, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'magnet') {
      ctx.strokeStyle = rgba(PALETTE.red, 0.12);
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 165 - i * 26, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = PALETTE.shadow;
      ctx.beginPath();
      ctx.arc(1, 4, 50, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.red, -0.25);
      ctx.beginPath();
      ctx.arc(0, 0, 50, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.red;
      ctx.beginPath();
      ctx.arc(0, 0, 42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.paper3;
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.teal;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.55);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(-9, -11, 22, Math.PI * 1.0, Math.PI * 1.55);
      ctx.stroke();
    } else if (p.defId === 'spiral') {
      const N = 168;
      const pts: { x: number; y: number; d: number }[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const lo = spiralLocal(t);
        pts.push({ x: lo.x, y: lo.y, d: spiralDepth(t) });
      }
      const normalAt = (i: number) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(N, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
      };
      const band = (back: boolean) => {
        for (let i = 0; i < N; i++) {
          const depth = (pts[i].d + pts[i + 1].d) / 2;
          if ((depth < 0) !== back) continue;
          const n1 = normalAt(i);
          const n2 = normalAt(i + 1);
          const l1 = { x: pts[i].x + n1.x * 15, y: pts[i].y + n1.y * 15 };
          const l2 = { x: pts[i + 1].x + n2.x * 15, y: pts[i + 1].y + n2.y * 15 };
          const r1 = { x: pts[i].x - n1.x * 15, y: pts[i].y - n1.y * 15 };
          const r2 = { x: pts[i + 1].x - n2.x * 15, y: pts[i + 1].y - n2.y * 15 };
          ctx.lineCap = 'round';
          // superficie del canal
          ctx.strokeStyle = back ? 'rgba(46,158,151,0.16)' : 'rgba(143,211,238,0.56)';
          ctx.lineWidth = back ? 26 : 30;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
          ctx.stroke();
          // raíles
          ctx.strokeStyle = back ? 'rgba(46,158,151,0.42)' : '#2E9E97';
          ctx.lineWidth = back ? 2.2 : 3.2;
          ctx.beginPath();
          ctx.moveTo(l1.x, l1.y);
          ctx.lineTo(l2.x, l2.y);
          ctx.moveTo(r1.x, r1.y);
          ctx.lineTo(r2.x, r2.y);
          ctx.stroke();
          if (!back) {
            ctx.strokeStyle = 'rgba(255,255,255,0.36)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(l1.x - 1, l1.y - 1);
            ctx.lineTo(l2.x - 1, l2.y - 1);
            ctx.stroke();
          }
        }
      };
      ctx.save();
      ctx.translate(1.5, 3);
      band(true);
      band(false);
      ctx.restore();
      // pequeñas láminas musicales
      for (let i = 0; i < 7; i++) {
        const t = (i + 1) / 8;
        const lo = spiralLocal(t);
        const col = NOTE_COLORS[i + 1] ?? NOTE_COLORS[0];
        ctx.fillStyle = PALETTE.shadow;
        ctx.beginPath();
        ctx.arc(lo.x + 1, lo.y + 2.5, 8, 0, TAU);
        ctx.fill();
        ctx.fillStyle = shade(col, -0.18);
        ctx.beginPath();
        ctx.arc(lo.x, lo.y, 7, 0, TAU);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(lo.x - 0.8, lo.y - 0.8, 5.2, 0, TAU);
        ctx.fill();
      }
      // boca de entrada
      const entry = SPIRAL_ENTRY;
      ctx.fillStyle = 'rgba(35,33,28,0.28)';
      ctx.beginPath();
      ctx.ellipse(entry.x, entry.y, 27, 13, -0.25, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = PALETTE.teal;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(entry.x, entry.y, 29, 15, -0.25, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(entry.x - 3, entry.y - 3, 20, 8, -0.25, Math.PI * 0.9, Math.PI * 1.6);
      ctx.stroke();
      // salida
      const exit = spiralLocal(1);
      ctx.fillStyle = PALETTE.teal;
      ctx.beginPath();
      ctx.ellipse(exit.x, exit.y + 4, 20, 9, 0.2, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'bubble') {
      ctx.save();
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -94, -4, 192, 26, 13);
      ctx.fill();
      ctx.fillStyle = 'rgba(143,211,238,0.78)';
      rr(ctx, -96, -8, 192, 24, 12);
      ctx.fill();
      ctx.strokeStyle = '#2E9E97';
      ctx.lineWidth = 2.8;
      rr(ctx, -96, -8, 192, 24, 12);
      ctx.stroke();
      for (let i = -4; i <= 4; i++) {
        const x = i * 20;
        const y = -10 - (i % 2 === 0 ? 4 : 0);
        ctx.fillStyle = 'rgba(255,253,248,0.72)';
        ctx.beginPath();
        ctx.arc(x, y + 8, 11.5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(46,158,151,0.95)';
        ctx.lineWidth = 1.9;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(x - 3, y + 4, 3.2, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(46,158,151,0.55)';
      rr(ctx, -88, 9, 176, 3, 1.5);
      ctx.fill();
      ctx.restore();
    } else if (p.defId === 'portal') {
      const ring = (x: number, col: string) => {
        ctx.save();
        ctx.translate(x, 0);
        ctx.fillStyle = PALETTE.shadow;
        ctx.beginPath();
        ctx.arc(1, 3, 32, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(col, 0.18);
        ctx.beginPath();
        ctx.arc(0, 0, 33, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = shade(col, -0.26);
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffffff', 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-7, -8, 19, Math.PI * 0.9, Math.PI * 1.5);
        ctx.stroke();
        ctx.strokeStyle = rgba(PALETTE.teal, 0.75);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 15, -0.4, 2.1);
        ctx.stroke();
        ctx.restore();
      };
      ring(-62, PALETTE.purple);
      ring(62, PALETTE.teal);
      ctx.strokeStyle = 'rgba(35,33,28,0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(-33, 0);
      ctx.quadraticCurveTo(0, -25, 33, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.defId === 'fan') {
      ctx.fillStyle = 'rgba(46,158,151,0.12)';
      rr(ctx, -48, -104, 96, 208, 24);
      ctx.fill();
      ctx.strokeStyle = 'rgba(46,158,151,0.5)';
      ctx.lineWidth = 2;
      rr(ctx, -48, -104, 96, 208, 24);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.teal;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const y = 40 + i * 34;
        ctx.beginPath();
        ctx.moveTo(-20, y + 10);
        ctx.lineTo(0, y - 8);
        ctx.lineTo(20, y + 10);
        ctx.stroke();
      }
      ctx.fillStyle = shade(PALETTE.teal, -0.2);
      rr(ctx, -52, 82, 104, 24, 10);
      ctx.fill();
      ctx.fillStyle = PALETTE.teal;
      rr(ctx, -44, 76, 88, 16, 8);
      ctx.fill();
    } else if (p.defId === 'xylo3' || p.defId === 'xylo5' || p.defId === 'xylo8') {
      const n = p.defId === 'xylo3' ? 3 : p.defId === 'xylo5' ? 5 : 8;
      const layout = xyloLayout(n);
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -layout.total / 2 - 9, 3, layout.total + 18, 30, 10);
      ctx.fill();
      ctx.fillStyle = PALETTE.woodDark;
      rr(ctx, -layout.total / 2 - 10, -2, layout.total + 20, 32, 10);
      ctx.fill();
      ctx.fillStyle = PALETTE.wood;
      rr(ctx, -layout.total / 2 - 6, -2, layout.total + 12, 26, 8);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.25);
      ctx.lineWidth = 1.4;
      rr(ctx, -layout.total / 2 - 6, -2, layout.total + 12, 26, 8);
      ctx.stroke();
      for (let i = 0; i < n; i++) {
        const w = layout.widths[i];
        const x = layout.xs[i];
        const col = NOTE_COLORS[i] ?? NOTE_COLORS[0];
        ctx.fillStyle = PALETTE.shadow;
        rr(ctx, x - w / 2 + 1, -8 + 3, w, 14, 6);
        ctx.fill();
        ctx.fillStyle = shade(col, -0.16);
        rr(ctx, x - w / 2, -11, w, 15, 6);
        ctx.fill();
        ctx.fillStyle = col;
        rr(ctx, x - w / 2 + 1, -10, w - 2, 12, 5);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', 0.35);
        ctx.lineWidth = 1.2;
        rr(ctx, x - w / 2 + 4, -8.5, w - 8, 3, 2);
        ctx.stroke();
        // note dot
        ctx.fillStyle = rgba(PALETTE.ink, 0.35);
        ctx.beginPath();
        ctx.arc(x - w / 2 + 8, -4, 2.2, 0, TAU);
        ctx.fill();
      }
    }
  }, !noExtrude, shade(base, -0.42));
}

function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  fill: string,
  stroke: string
) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rgba(stroke, 0.25);
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function getMarbleSprite(type: MarbleType): Sprite {
  const hit = marbleCache.get(type.id);
  if (hit) return hit;
  const metal = type.id === 'steel';
  const rubber = type.id === 'rubber';
  const s = makeSprite(34, 34, (ctx) => {
    const r = 17;

    // Esfera base: la luz viene de arriba a la izquierda.
    const g = ctx.createRadialGradient(-6, -7, 1, 0, 1.5, r);
    if (metal) {
      g.addColorStop(0, '#F7FAFC');
      g.addColorStop(0.24, shade(type.color, 0.5));
      g.addColorStop(0.48, type.color);
      g.addColorStop(0.66, shade(type.color, -0.34));
      g.addColorStop(0.82, shade(type.color, 0.16));
      g.addColorStop(1, shade(type.color, -0.52));
    } else if (rubber) {
      g.addColorStop(0, shade(type.color, 0.44));
      g.addColorStop(0.42, shade(type.color, 0.14));
      g.addColorStop(0.8, type.color);
      g.addColorStop(1, shade(type.color, -0.44));
    } else {
      g.addColorStop(0, shade(type.color, 0.82));
      g.addColorStop(0.3, shade(type.color, 0.36));
      g.addColorStop(0.7, type.color);
      g.addColorStop(1, shade(type.color, -0.4));
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.4, 0, TAU);
    ctx.clip();

    if (metal) {
      // Reflejo de estudio: banda de horizonte y destello alargado.
      const band = ctx.createLinearGradient(0, -r, 0, r);
      band.addColorStop(0.3, 'rgba(255,255,255,0)');
      band.addColorStop(0.44, 'rgba(255,255,255,0.34)');
      band.addColorStop(0.53, 'rgba(255,255,255,0.05)');
      band.addColorStop(0.66, 'rgba(35,33,28,0.12)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      ctx.ellipse(-5.5, -7.5, 5.4, 3.1, -0.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(0, 0, 12.6, 0.1, Math.PI * 0.9);
      ctx.stroke();
    } else if (rubber) {
      // Goma: mate, con grano fino y brillo ancho y suave.
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.beginPath();
      ctx.ellipse(-5.8, -7.2, 5.2, 3.4, -0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(35,33,28,0.1)';
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const rr = 4 + (i % 4) * 2.6;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 1.1, 0.75, 0, TAU);
        ctx.fill();
      }
    } else {
      // Cristal: burbuja interior, arco especular y cáustica inferior.
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(-1.5, 1.5, r * 0.62, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0.6, 1.2, 9.6, -2.65, -1.02);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.beginPath();
      ctx.ellipse(5.2, 7.4, 3.6, 1.7, -0.4, 0, TAU);
      ctx.fill();
    }

    // Luz de rebote en el borde opuesto a la fuente.
    ctx.strokeStyle = `rgba(255,255,255,${rubber ? 0.16 : 0.32})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1.4, 0.42, 2.1);
    ctx.stroke();

    if (type.premium) {
      // Iridiscencia: dos arcos de color complementario.
      ctx.strokeStyle = rgba(type.glow ?? type.color, 0.55);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, r - 2.4, -1.2, 1.1);
      ctx.stroke();
      ctx.strokeStyle = rgba(shade(type.glow ?? type.color, -0.2), 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r - 4.1, 0.3, 2.5);
      ctx.stroke();
    }
    ctx.restore();

    // Contorno y especular principal.
    ctx.strokeStyle = rgba(PALETTE.ink, 0.24);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.7, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = rgba('#ffffff', rubber ? 0.62 : 0.86);
    ctx.beginPath();
    ctx.ellipse(-5.5, -7, 4.6, 3.2, -0.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba('#ffffff', 0.42);
    ctx.beginPath();
    ctx.arc(5, 6, 2.2, 0, TAU);
    ctx.fill();
  }, false);
  marbleCache.set(type.id, s);
  return s;
}

export function drawMarbleSprite(
  ctx: CanvasRenderingContext2D,
  type: MarbleType,
  x: number,
  y: number,
  r: number,
  alpha = 1
) {
  const s = getMarbleSprite(type);
  ctx.globalAlpha = alpha;
  const scale = (r * 2) / 34;
  ctx.drawImage(s.canvas, x - (s.w * scale) / 2, y - (s.h * scale) / 2, s.w * scale, s.h * scale);
  ctx.globalAlpha = 1;
}

export function drawPreview(canvas: HTMLCanvasElement, itemId: string, kind: 'piece' | 'marble' | 'icon') {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth || 120;
  const ch = canvas.clientHeight || 90;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (kind === 'icon') {
    drawGlyph(ctx, itemId, cw / 2, ch / 2, Math.min(cw, ch) * 0.34);
    return;
  }
  if (kind === 'marble') {
    const type = MARBLE_TYPES.find((m) => m.id === itemId);
    if (!type) return;
    drawMarbleSprite(ctx, type, cw / 2, ch / 2, Math.min(cw, ch) * 0.25);
    return;
  }
  const p: Piece = {
    id: -1,
    defId: itemId,
    x: 0,
    y: 0,
    rot: 0,
    len: 160,
    color: getPieceDef(itemId).defaultColor,
    variant: 0
  };
  const s = getPieceSprite(p);
  // Las piezas muy anchas (xilófonos) se recortan por los lados para que sus
  // láminas se lean; el resto se muestra completo.
  const scale = itemId.startsWith('xylo') || itemId === 'bubble' || itemId === 'conveyor'
    ? Math.min((ch - 14) / s.h, 2.2)
    : Math.min((cw - 16) / s.w, (ch - 14) / s.h, 2.2);
  ctx.drawImage(s.canvas, cw / 2 - (s.w * scale) / 2, ch / 2 - (s.h * scale) / 2, s.w * scale, s.h * scale);
}

function drawGlyph(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = PALETTE.ink;
  ctx.fillStyle = PALETTE.yellow;
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (name === 'spark') {
    star(ctx, 0, 0, r, r * 0.45, PALETTE.yellow, PALETTE.ink);
  } else if (name === 'loop') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.75, -2.2, 2.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.55, -r * 0.8);
    ctx.lineTo(r * 0.9, -r * 0.55);
    ctx.lineTo(r * 0.55, -r * 0.25);
    ctx.stroke();
  } else if (name === 'speed') {
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.5);
    ctx.lineTo(r * 0.1, 0);
    ctx.lineTo(-r, r * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.5);
    ctx.lineTo(r * 0.9, 0);
    ctx.lineTo(-r * 0.2, r * 0.5);
    ctx.stroke();
  } else if (name === 'air') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.85);
    ctx.quadraticCurveTo(0, -r * 1.2, r, -r * 0.55);
    ctx.stroke();
  } else if (name === 'build') {
    ctx.fillStyle = PALETTE.blue;
    rr(ctx, -r, -r * 0.3, r * 2, r * 0.8, r * 0.18);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.45, -r * 0.35, r * 0.2, 0, TAU);
    ctx.arc(r * 0.45, -r * 0.35, r * 0.2, 0, TAU);
    ctx.fill();
  } else if (name === 'note') {
    ctx.fillStyle = PALETTE.red;
    ctx.beginPath();
    ctx.arc(-r * 0.45, r * 0.45, r * 0.28, 0, TAU);
    ctx.arc(r * 0.55, r * 0.2, r * 0.28, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, r * 0.4);
    ctx.lineTo(-r * 0.18, -r * 0.8);
    ctx.lineTo(r * 0.82, -r * 0.95);
    ctx.lineTo(r * 0.82, r * 0.15);
    ctx.stroke();
  } else {
    star(ctx, 0, 0, r, r * 0.45, PALETTE.yellow, PALETTE.ink);
  }
  ctx.restore();
}
