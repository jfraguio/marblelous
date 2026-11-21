import type { MarbleType, Piece } from './types';
import {
  COLORS,
  FACTORY_LAMP,
  FUNNEL_LEFT,
  FUNNEL_RIGHT,
  MARBLE_TYPES,
  NOTE_COLORS,
  PALETTE,
  RAMP_CURVE_END,
  RAMP_CURVE_RADIUS,
  RAMP_CURVE_START,
  SPIRAL_ENTRY,
  spiralDepth,
  spiralLocal,
  defaultLen,
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
  if (p.defId === 'xylo5') return PALETTE.wood;
  if (p.defId === 'conveyor') return PALETTE.steel;
  if (p.defId === 'bumper') return PALETTE.red;
  if (p.defId === 'booster') return PALETTE.teal;
  if (p.defId === 'cannon') return PALETTE.purple;
  if (p.defId === 'goal') return PALETTE.yellow;
  if (p.defId === 'star') return PALETTE.yellow;
  if (p.defId === 'spiral') return PALETTE.teal;
  if (p.defId === 'bubble') return '#8FD3EE';
  if (p.defId === 'bubbleLift') return '#8FD3EE';
  if (p.defId === 'marbleFactory') return PALETTE.teal;
  if (p.defId === 'portal') return PALETTE.purple;
  if (p.defId === 'fan') return PALETTE.teal;
  if (p.defId === 'electromagnet') return PALETTE.steel;
  if (d.tintable) return COLORS[p.color] ?? COLORS[d.defaultColor] ?? PALETTE.blue;
  return COLORS[d.defaultColor] ?? PALETTE.blue;
}

function spriteDims(p: Piece): { w: number; h: number } {
  switch (p.defId) {
    case 'ramp':
      return { w: p.len + 16, h: 26 };
    case 'rampCurve':
      return { w: RAMP_CURVE_RADIUS * 2 + 18, h: RAMP_CURVE_RADIUS * 2 + 18 };
    case 'funnel':
      return { w: 220, h: 200 };
    case 'xylo5': {
      const n = 5;
      const l = xyloLayout(n);
      return { w: l.total + 24, h: 62 };
    }
    case 'spiral':
      return { w: 300, h: 330 };
    case 'bubble':
      return { w: 250, h: 40 };
    case 'bubbleLift':
      return { w: 156, h: 196 };
    case 'marbleFactory':
      return { w: 148, h: 176 };
    case 'portal':
      return { w: p.len + 84, h: 120 };
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
      return { w: 336, h: 28 };
    case 'balance':
      return { w: 300, h: 140 };
    case 'electromagnet':
      return { w: 112, h: 112 };
    case 'hourglass':
      return { w: 104, h: 148 };
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

    if (p.defId === 'ramp') {
      const L = p.len;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PALETTE.shadow;
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 2, 5);
      ctx.lineTo(L / 2 + 2, 5);
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0);
      ctx.lineTo(L / 2, 0);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.strokeStyle = light;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-L / 2, -4.5);
      ctx.lineTo(L / 2, -4.5);
      ctx.stroke();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.28);
      ctx.lineWidth = 1.2;
      for (const ex of [-L / 2 + 0.8, L / 2 - 0.8]) {
        ctx.beginPath();
        ctx.moveTo(ex, -9.5);
        ctx.lineTo(ex, 9.5);
        ctx.stroke();
      }
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
    } else if (p.defId === 'funnel') {
      const L = FUNNEL_LEFT;
      const R = FUNNEL_RIGHT;
      // cuerpo del embudo
      ctx.beginPath();
      ctx.moveTo(L[0].x, L[0].y);
      for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
      for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
      ctx.closePath();
      const body = ctx.createLinearGradient(0, -80, 0, 84);
      body.addColorStop(0, rgba(c, 0.14));
      body.addColorStop(0.55, rgba(c, 0.26));
      body.addColorStop(1, rgba(c, 0.1));
      ctx.fillStyle = body;
      ctx.fill();

      const drawCurve = (pts: { x: number; y: number }[], col: string, lw: number, off = 0) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x + off, pts[0].y + off);
        for (const pt of pts.slice(1)) ctx.lineTo(pt.x + off, pt.y + off);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(1.5, 3);
      drawCurve(L, PALETTE.shadow, 13);
      drawCurve(R, PALETTE.shadow, 13);
      ctx.restore();
      drawCurve(L, dark, 13);
      drawCurve(R, dark, 13);
      drawCurve(L, c, 9);
      drawCurve(R, c, 9);

      // boca superior
      ctx.fillStyle = 'rgba(35,33,28,0.14)';
      ctx.beginPath();
      ctx.ellipse(0, -80, 96, 12, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(c, 0.32);
      ctx.beginPath();
      ctx.ellipse(0, -80, 92, 9, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(0, -80, 96, 12, 0, 0, TAU);
      ctx.stroke();

      // cuello / salida
      ctx.fillStyle = 'rgba(35,33,28,0.2)';
      ctx.beginPath();
      ctx.ellipse(0, 84, 38, 7, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = shade(c, -0.25);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 82, 40, 9, 0, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = rgba('#ffffff', 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(L[2].x - 2, L[2].y);
      ctx.lineTo(L[L.length - 2].x - 2, L[L.length - 2].y);
      ctx.moveTo(R[2].x + 2, R[2].y);
      ctx.lineTo(R[R.length - 2].x + 2, R[R.length - 2].y);
      ctx.stroke();
    } else if (p.defId === 'balance') {
      // Barra basculante con fulcro redondo en el centro.
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PALETTE.shadow;
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(-118, 5);
      ctx.lineTo(118, 5);
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 24;
      ctx.beginPath();
      ctx.moveTo(-122, 0);
      ctx.lineTo(122, 0);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 19;
      ctx.stroke();
      ctx.strokeStyle = light;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(-122, -6);
      ctx.lineTo(122, -6);
      ctx.stroke();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.18);
      ctx.lineWidth = 1.3;
      for (const x of [-94, 94]) {
        ctx.beginPath();
        ctx.moveTo(x, -8.5);
        ctx.lineTo(x, 8.5);
        ctx.stroke();
      }
      // Fulcro metálico circular.
      ctx.fillStyle = shade(PALETTE.steel, -0.42);
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PALETTE.steel;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-4, -4, 9, Math.PI * 0.9, Math.PI * 1.7);
      ctx.stroke();
      ctx.fillStyle = rgba(PALETTE.ink, 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'conveyor') {
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -156, -1, 312, 24, 9);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.steel, -0.3);
      rr(ctx, -160, -13, 320, 26, 9);
      ctx.fill();
      ctx.fillStyle = '#59636D';
      rr(ctx, -148, -7, 296, 14, 5);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.18);
      ctx.lineWidth = 1.4;
      rr(ctx, -160, -13, 320, 26, 9);
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
      ctx.fillStyle = 'rgba(35,33,28,0.1)';
      rr(ctx, -112, 5, 224, 12, 6);
      ctx.fill();

      const ice = ctx.createLinearGradient(0, -11, 0, 11);
      ice.addColorStop(0, 'rgba(242,252,255,0.62)');
      ice.addColorStop(0.4, 'rgba(178,232,255,0.42)');
      ice.addColorStop(1, 'rgba(92,172,220,0.34)');
      ctx.fillStyle = ice;
      ctx.beginPath();
      ctx.moveTo(-112, -6);
      ctx.lineTo(-86, -9);
      ctx.lineTo(-52, -7);
      ctx.lineTo(-18, -10);
      ctx.lineTo(16, -7);
      ctx.lineTo(54, -9);
      ctx.lineTo(84, -6);
      ctx.lineTo(112, -8);
      ctx.lineTo(114, 6);
      ctx.lineTo(82, 4);
      ctx.lineTo(44, 8);
      ctx.lineTo(10, 5);
      ctx.lineTo(-24, 8);
      ctx.lineTo(-60, 5);
      ctx.lineTo(-94, 8);
      ctx.lineTo(-114, 5);
      ctx.closePath();
      ctx.fill();

      // facetas
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(-112, -6);
      ctx.lineTo(-86, -9);
      ctx.lineTo(-52, -7);
      ctx.lineTo(-70, -1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(16, -7);
      ctx.lineTo(54, -9);
      ctx.lineTo(84, -6);
      ctx.lineTo(62, 0);
      ctx.closePath();
      ctx.fill();

      // aristas
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-108, -5.5);
      ctx.lineTo(-86, -8);
      ctx.lineTo(-52, -6);
      ctx.lineTo(-18, -9);
      ctx.lineTo(16, -6);
      ctx.lineTo(54, -8);
      ctx.lineTo(84, -5);
      ctx.lineTo(108, -7);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(42,100,145,0.38)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-110, 5);
      ctx.lineTo(-60, 4);
      ctx.lineTo(-24, 7);
      ctx.lineTo(10, 4);
      ctx.lineTo(44, 7);
      ctx.lineTo(82, 3);
      ctx.lineTo(112, 5);
      ctx.stroke();

      // grietas de hielo
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-76, -4);
      ctx.lineTo(-60, 3);
      ctx.lineTo(-42, -2);
      ctx.moveTo(-8, -6);
      ctx.lineTo(3, 2);
      ctx.lineTo(19, -3);
      ctx.moveTo(47, -5);
      ctx.lineTo(58, 4);
      ctx.lineTo(76, -1);
      ctx.moveTo(22, -1);
      ctx.lineTo(26, 6);
      ctx.moveTo(-56, 4);
      ctx.lineTo(-50, -3);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,200,235,0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-62, -7);
      ctx.lineTo(-48, -2);
      ctx.moveTo(58, -8);
      ctx.lineTo(66, -2);
      ctx.stroke();

      // escarcha
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 9; i++) {
        const x = -100 + i * 25;
        const y = (i % 2 === 0 ? -4 : 4) + (i % 3);
        ctx.beginPath();
        ctx.arc(x, y, 0.9 + (i % 2), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    } else if (p.defId === 'bubbleLift') {
      ctx.fillStyle = PALETTE.shadow;
      rr(ctx, -34, 58, 68, 18, 9);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.teal, -0.3);
      rr(ctx, -38, 50, 76, 18, 9);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.teal, -0.08);
      rr(ctx, -30, 44, 60, 12, 6);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.12);
      ctx.lineWidth = 1.4;
      rr(ctx, -38, 50, 76, 18, 9);
      ctx.stroke();

      // collarines laterales para acoplar rampas
      for (const side of [-1, 1]) {
        ctx.fillStyle = shade(PALETTE.teal, -0.38);
        rr(ctx, side * 48 - 8, -8, 16, 16, 5);
        ctx.fill();
        ctx.fillStyle = shade(PALETTE.teal, -0.12);
        rr(ctx, side * 48 - 5, -5, 10, 10, 3);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', 0.5);
        ctx.lineWidth = 1.2;
        rr(ctx, side * 48 - 5, -5, 10, 10, 3);
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(0, 0);
      ctx.strokeStyle = shade(PALETTE.teal, -0.28);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(0, 0, 48, 48, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.teal;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 48, 48, 0, 0, TAU);
      ctx.stroke();
      const film = ctx.createLinearGradient(-42, -42, 42, 42);
      film.addColorStop(0, 'rgba(143,211,238,0.58)');
      film.addColorStop(0.32, 'rgba(255,255,255,0.14)');
      film.addColorStop(0.52, 'rgba(210,109,140,0.34)');
      film.addColorStop(0.72, 'rgba(233,180,76,0.28)');
      film.addColorStop(1, 'rgba(79,157,105,0.34)');
      ctx.fillStyle = film;
      ctx.beginPath();
      ctx.ellipse(0, 0, 43, 43, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 41, -2.4, -0.75);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0.55, 2.35);
      ctx.stroke();
      ctx.restore();
    } else if (p.defId === 'marbleFactory') {
      // Patas y sombra.
      ctx.fillStyle = PALETTE.shadow;
      ctx.beginPath();
      ctx.ellipse(0, 72, 54, 11, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.steel, -0.5);
      rr(ctx, -46, 46, 24, 20, 6);
      ctx.fill();
      rr(ctx, 22, 46, 24, 20, 6);
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.steel, -0.18);
      rr(ctx, -44, 44, 20, 11, 5);
      ctx.fill();
      rr(ctx, 24, 44, 20, 11, 5);
      ctx.fill();

      // Cuerpo principal.
      ctx.fillStyle = shade(PALETTE.teal, -0.42);
      rr(ctx, -48, -20, 96, 72, 16);
      ctx.fill();
      ctx.fillStyle = PALETTE.teal;
      rr(ctx, -44, -18, 88, 66, 14);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.24);
      ctx.lineWidth = 2;
      rr(ctx, -42, -16, 84, 16, 8);
      ctx.stroke();

      // Panel frontal con engranajes.
      ctx.fillStyle = shade(PALETTE.teal, -0.24);
      rr(ctx, -33, 1, 58, 40, 10);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.2);
      ctx.lineWidth = 1.4;
      rr(ctx, -33, 1, 58, 40, 10);
      ctx.stroke();
      const gear = (gx: number, gy: number, rad: number) => {
        ctx.fillStyle = shade(PALETTE.steel, -0.1);
        ctx.beginPath();
        const teeth = 7;
        for (let i = 0; i < teeth * 2; i++) {
          const a = (i / (teeth * 2)) * TAU;
          const gr2 = i % 2 === 0 ? rad : rad * 0.76;
          const gx2 = gx + Math.cos(a) * gr2;
          const gy2 = gy + Math.sin(a) * gr2;
          if (i === 0) ctx.moveTo(gx2, gy2);
          else ctx.lineTo(gx2, gy2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(PALETTE.steel, 0.22);
        ctx.beginPath();
        ctx.arc(gx, gy, rad * 0.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2B2D33';
        ctx.beginPath();
        ctx.arc(gx, gy, rad * 0.18, 0, TAU);
        ctx.fill();
      };
      gear(-14, 21, 9);
      gear(9, 26, 7);
      gear(15, 9, 5);

      // Boquilla de salida.
      ctx.fillStyle = shade(PALETTE.steel, -0.4);
      rr(ctx, -14, 47, 28, 17, 6);
      ctx.fill();
      ctx.fillStyle = PALETTE.steel;
      rr(ctx, -10, 48, 20, 13, 5);
      ctx.fill();
      ctx.fillStyle = '#23252B';
      ctx.beginPath();
      ctx.ellipse(0, 63, 12, 4.5, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.35);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(0, 63, 12, 4.5, 0, 0, TAU);
      ctx.stroke();

      // Cuello y tolva de cristal.
      ctx.fillStyle = shade(PALETTE.steel, -0.34);
      rr(ctx, -31, -32, 62, 18, 8);
      ctx.fill();
      ctx.fillStyle = PALETTE.steel;
      rr(ctx, -27, -30, 54, 12, 6);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.45);
      ctx.lineWidth = 1.2;
      rr(ctx, -27, -30, 54, 4, 2);
      ctx.stroke();

      const globeY = -58;
      const globeR = 34;
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, globeY, globeR, 0, TAU);
      ctx.clip();
      const glass = ctx.createRadialGradient(-12, globeY - 14, 3, 0, globeY, globeR);
      glass.addColorStop(0, 'rgba(240,252,255,0.82)');
      glass.addColorStop(0.55, 'rgba(180,230,248,0.44)');
      glass.addColorStop(1, 'rgba(116,188,218,0.6)');
      ctx.fillStyle = glass;
      ctx.fillRect(-globeR, globeY - globeR, globeR * 2, globeR * 2);
      const balls: [number, number, number, string][] = [
        [-14, -63, 7.4, COLORS[1]],
        [-2, -72, 6.6, COLORS[2]],
        [11, -61, 7.8, COLORS[0]],
        [-8, -48, 8, COLORS[3]],
        [7, -46, 7.2, COLORS[4]],
        [21, -72, 5.8, COLORS[5]],
        [0, -58, 6.8, COLORS[0]],
        [19, -46, 5.8, COLORS[2]]
      ];
      for (const [bx, by, br, col] of balls) {
        ctx.fillStyle = shade(col, -0.2);
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, TAU);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bx - 0.6, by - 0.8, br * 0.84, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.55);
        ctx.beginPath();
        ctx.arc(bx - br * 0.32, by - br * 0.36, br * 0.26, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(0, globeY, globeR, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = shade(PALETTE.steel, -0.22);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, globeY, globeR + 1, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.55);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, globeY, globeR + 1, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.7);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, globeY, globeR - 7, -2.4, -1.15);
      ctx.stroke();

      // Zócalo de la lucecita de estado (el color lo pinta el renderer).
      ctx.fillStyle = '#2B2D33';
      ctx.beginPath();
      ctx.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 5.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.4);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 8, 0, TAU);
      ctx.stroke();
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
      const half = p.len > 0 ? p.len / 2 : 62;
      ring(-half, PALETTE.purple);
      ring(half, PALETTE.teal);
      const inner = Math.max(8, half - 33);
      ctx.strokeStyle = 'rgba(35,33,28,0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(-inner, 0);
      ctx.quadraticCurveTo(0, -Math.min(25, inner * 0.8), inner, 0);
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
    } else if (p.defId === 'electromagnet') {
      // Herradura metálica con bobina de cobre y polos coloreados.
      const horseshoe = () => {
        ctx.beginPath();
        ctx.moveTo(-24, -30);
        ctx.lineTo(-24, 4);
        ctx.quadraticCurveTo(-24, 30, 0, 30);
        ctx.quadraticCurveTo(24, 30, 24, 4);
        ctx.lineTo(24, -30);
      };
      ctx.lineCap = 'round';
      ctx.strokeStyle = PALETTE.shadow;
      ctx.lineWidth = 22;
      ctx.save();
      ctx.translate(2, 5);
      horseshoe();
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = shade(PALETTE.steel, -0.42);
      ctx.lineWidth = 22;
      horseshoe();
      ctx.stroke();
      ctx.strokeStyle = PALETTE.steel;
      ctx.lineWidth = 16;
      horseshoe();
      ctx.stroke();
      // Polos.
      ctx.fillStyle = PALETTE.red;
      rr(ctx, -36, -40, 22, 18, 5);
      ctx.fill();
      ctx.fillStyle = PALETTE.blue;
      rr(ctx, 14, -40, 22, 18, 5);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.3);
      ctx.lineWidth = 1.2;
      rr(ctx, -36, -40, 22, 18, 5);
      ctx.stroke();
      rr(ctx, 14, -40, 22, 18, 5);
      ctx.stroke();
      // Bobina de cobre.
      ctx.strokeStyle = '#C9823E';
      ctx.lineWidth = 3.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 7, 19 + i * 5, Math.PI * 0.18, Math.PI * 0.82);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba('#ffffff', 0.3);
      ctx.lineWidth = 1.4;
      horseshoe();
      ctx.stroke();
    } else if (p.defId === 'hourglass') {
      // Reloj de arena de madera y cristal con la arena dorada.
      ctx.fillStyle = PALETTE.shadow;
      ctx.beginPath();
      ctx.ellipse(0, 58, 36, 7, 0, 0, TAU);
      ctx.fill();
      // Tapas de madera.
      for (const y of [-62, 48]) {
        ctx.fillStyle = PALETTE.woodDark;
        rr(ctx, -34, y, 68, 14, 6);
        ctx.fill();
        ctx.fillStyle = PALETTE.wood;
        rr(ctx, -30, y + 2, 60, 8, 4);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', 0.22);
        ctx.lineWidth = 1.2;
        rr(ctx, -30, y + 2, 60, 8, 4);
        ctx.stroke();
      }
      // Vidrio.
      const glass = ctx.createLinearGradient(0, -46, 0, 46);
      glass.addColorStop(0, 'rgba(225,247,255,0.62)');
      glass.addColorStop(0.5, 'rgba(180,227,240,0.35)');
      glass.addColorStop(1, 'rgba(126,196,218,0.5)');
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.moveTo(-22, -46);
      ctx.lineTo(22, -46);
      ctx.lineTo(3, -2);
      ctx.lineTo(22, 46);
      ctx.lineTo(-22, 46);
      ctx.lineTo(-3, -2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', 0.62);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Arena arriba y abajo.
      ctx.fillStyle = PALETTE.yellow;
      ctx.beginPath();
      ctx.moveTo(-17, -42);
      ctx.lineTo(17, -42);
      ctx.lineTo(1, -19);
      ctx.lineTo(-1, -19);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(PALETTE.yellow, -0.08);
      ctx.beginPath();
      ctx.moveTo(-19, 42);
      ctx.lineTo(19, 42);
      ctx.lineTo(0, 25);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.yellow, 0.9);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -17);
      ctx.lineTo(0, 25);
      ctx.stroke();
      // Brillo del cristal.
      ctx.strokeStyle = rgba('#ffffff', 0.55);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-15, -38);
      ctx.lineTo(-6, -8);
      ctx.moveTo(15, 36);
      ctx.lineTo(7, 12);
      ctx.stroke();
    } else if (p.defId === 'xylo5') {
      const n = 5;
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
  const rainbow = type.id === 'rainbow';
  const s = makeSprite(34, 34, (ctx) => {
    const r = 17;
    if (type.id === 'surprise') {
      ctx.fillStyle = '#F7F1E3';
      ctx.beginPath();
      ctx.arc(0, 0, r - 0.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.ink, 0.4);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, r - 1.2, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '800 21px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 1);
      ctx.fillStyle = rgba(PALETTE.yellow, 0.7);
      ctx.beginPath();
      ctx.arc(-6, -7.5, 2.6, 0, TAU);
      ctx.fill();
      return;
    }

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

    if (rainbow) {
      const bands = ctx.createLinearGradient(-r, -r, r, r);
      bands.addColorStop(0, '#E85D5D');
      bands.addColorStop(0.18, '#E9B44C');
      bands.addColorStop(0.36, '#7BC98F');
      bands.addColorStop(0.54, '#5FD3D0');
      bands.addColorStop(0.72, '#5B9BD5');
      bands.addColorStop(0.88, '#B45AE8');
      bands.addColorStop(1, '#D26D8C');
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = bands;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      const sheen = ctx.createRadialGradient(-6, -7, 1, 0, 1.5, r);
      sheen.addColorStop(0, 'rgba(255,255,255,0.8)');
      sheen.addColorStop(0.4, 'rgba(255,255,255,0.16)');
      sheen.addColorStop(0.85, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(20,20,40,0.16)');
      ctx.fillStyle = sheen;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(-1.5, 1.5, r * 0.5, 0, TAU);
      ctx.fill();
    } else if (metal) {
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

let bubbleSprite: Sprite | null = null;

export function getBubbleSprite(): Sprite {
  if (bubbleSprite) return bubbleSprite;
  const size = 128;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, size / 2);
  g.addColorStop(0, 'rgba(225,248,255,0.02)');
  g.addColorStop(0.55, 'rgba(200,240,255,0.05)');
  g.addColorStop(0.82, 'rgba(150,220,255,0.22)');
  g.addColorStop(0.93, 'rgba(255,255,255,0.62)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 4, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(cx - 22, cy - 24, 20, 10, -0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(cx + 18, cy + 22, 5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(210,109,140,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 8, 0.7, 2.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(143,211,238,0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 11, 3.4, 4.8);
  ctx.stroke();
  bubbleSprite = { canvas: c, w: size, h: size };
  return bubbleSprite;
}

export function drawBubbleSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha = 1
) {
  const s = getBubbleSprite();
  ctx.globalAlpha = alpha;
  const scale = (r * 2) / s.w;
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
    len: defaultLen(itemId),
    color: getPieceDef(itemId).defaultColor,
    variant: 0
  };
  const s = getPieceSprite(p);
  // Las piezas muy anchas (xilófonos) se recortan por los lados para que sus
  // láminas se lean; el resto se muestra completo.
  const scale = itemId.startsWith('xylo') || itemId === 'conveyor' || itemId === 'balance'
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
