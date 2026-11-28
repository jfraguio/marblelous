import type { MarbleType, Piece } from './types';
import {
  COLORS,
  CHANNEL_ENTRY,
  CHANNEL_EXIT,
  SPLITTER_EXIT_X,
  FAN_HALF,
  FAN_OUTLET,
  FACTORY_LAMP,
  MARBLE_TYPES,
  NOTE_COLORS,
  PALETTE,
  RAMP_CURVE_END,
  RAMP_CURVE_RADIUS,
  RAMP_CURVE_START,
  S_TRACK,
  funnelLayout,
  pieceHitSize,
  pieceLength,
  spiralDepth,
  spiralLocal,
  defaultLen,
  getPieceDef,
  xyloLayout
} from './pieces';
import { makeCanvas, rgba, shade, TAU } from './util';

export const PAD = 18;
/** Escala nominal de horneado: el renderer ajusta el LOD con setSpriteScale. */
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
let spriteScale = SPRITE_SCALE;
let piecePixels = 0;
let shadowPixels = 0;

/** Ajusta la resolución con la que se hornean las piezas (LOD por zoom × DPR). */
export function setSpriteScale(scale: number) {
  const next = Math.max(1, Math.min(3.25, Math.round(scale * 4) / 4));
  if (next !== spriteScale) spriteScale = next;
}

export function getSpriteScale() {
  return spriteScale;
}

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

/**
 * Dirección de la luz de estudio (desde la escena hacia la fuente): arriba a la
 * izquierda. Todos los volúmenes y sombras de la escena la comparten.
 */
export const LIGHT_X = -0.56;
export const LIGHT_Y = -0.83;

/**
 * Lenguaje visual del rediseño: tinta azul marino gruesa, cuerpos con degradado
 * vertical brillante y herrajes cromados. Todos los helpers comparten la misma
 * tinta y la misma dirección de luz.
 */
const INK = '#1E3A5C';

function mix(a: string, b: string, t: number): string {
  const pa = a.replace('#', '');
  const pb = b.replace('#', '');
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${f(ch(pa, 0), ch(pb, 0))}${f(ch(pa, 2), ch(pb, 2))}${f(ch(pa, 4), ch(pb, 4))}`;
}

function ink(ctx: CanvasRenderingContext2D, w = 2.6) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

/**
 * Degradado de barra: como las rampas giran en cualquier dirección, el brillo
 * se reparte entre los dos cantos para que la pieza siga leyéndose bien girada.
 */
function tubeGrad(ctx: CanvasRenderingContext2D, color: string, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, mix(color, '#FFFFFF', 0.52));
  g.addColorStop(0.22, mix(color, '#FFFFFF', 0.2));
  g.addColorStop(0.55, color);
  g.addColorStop(0.84, mix(color, '#0E1B2C', 0.2));
  g.addColorStop(1, mix(color, '#FFFFFF', 0.14));
  return g;
}

/** Degradado de cuerpo: brillo arriba, color base al centro, sombra abajo. */
function bodyGrad(ctx: CanvasRenderingContext2D, color: string, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, mix(color, '#FFFFFF', 0.38));
  g.addColorStop(0.24, mix(color, '#FFFFFF', 0.12));
  g.addColorStop(0.58, color);
  g.addColorStop(0.86, mix(color, '#0E1B2C', 0.18));
  g.addColorStop(1, mix(color, '#0E1B2C', 0.36));
  return g;
}

/** Degradado de cromo: claro arriba, caña en el centro, rebote abajo. */
function chromeGrad(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.18, '#E6EEF6');
  g.addColorStop(0.44, '#B4C4D6');
  g.addColorStop(0.6, '#8499B0');
  g.addColorStop(0.78, '#CBD9E7');
  g.addColorStop(1, '#7E92A9');
  return g;
}

function fillPath(
  ctx: CanvasRenderingContext2D,
  build: (ctx: CanvasRenderingContext2D) => void,
  fill: string | CanvasGradient,
  w = 2.6
) {
  ctx.beginPath();
  build(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  ink(ctx, w);
  ctx.stroke();
}

function gloss(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, alpha = 0.5) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
}

/** Tope cromado con contorno de tinta y brillo vertical. */
function chromeCap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 7) {
  fillPath(ctx, (c2) => rr(c2, x, y, w, h, r), chromeGrad(ctx, y, y + h), 2.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.28, y + h * 0.22);
  ctx.lineTo(x + w * 0.28, y + h * 0.78);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,58,92,0.18)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.74, y + h * 0.24);
  ctx.lineTo(x + w * 0.74, y + h * 0.76);
  ctx.stroke();
}

/** Remache o perno cromado. */
function stud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  fillPath(ctx, (c2) => {
    c2.arc(x, y, r, 0, TAU);
  }, chromeGrad(ctx, y - r, y + r), Math.max(1.4, r * 0.34));
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.34, r * 0.28, 0, TAU);
  ctx.fill();
}

/** Veta de madera sutil, horneada. */
function grain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = 'rgba(120,72,32,0.18)') {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    const gy = y + ((i + 0.5) / 4) * h;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.bezierCurveTo(x + w * 0.3, gy - h * 0.12, x + w * 0.65, gy + h * 0.12, x + w, gy - h * 0.04);
    ctx.stroke();
  }
  ctx.restore();
}

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
  scale = spriteScale
): Sprite {
  const w = Math.max(1, worldW + PAD * 2);
  const h = Math.max(1, worldH + PAD * 2);
  const canvas = makeCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.translate(w / 2, h / 2);
  draw(ctx);
  return { canvas, w, h };
}

export function setSpriteBudget(n: number) {
  cacheBudget = Math.max(40, n);
  trimCache();
}

function trimCache() {
  // El presupuesto cuenta piezas, pero la memoria crece con la escala al
  // cuadrado: al subir el LOD se guardan menos variantes para no disparar los MB.
  const maxPixels = cacheBudget * 82_000;
  while (cache.size > cacheBudget || piecePixels > maxPixels) {
    const [key, sprite] = cache.entries().next().value!;
    piecePixels -= sprite.canvas.width * sprite.canvas.height;
    cache.delete(key);
  }
  while (shadowCache.size > cacheBudget || shadowPixels > maxPixels * 0.19) {
    const [key, sprite] = shadowCache.entries().next().value!;
    shadowPixels -= sprite.canvas.width * sprite.canvas.height;
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
      return { w: pieceLength(p) + 34, h: 200 };
    case 'xylo5': {
      const n = 5;
      const l = xyloLayout(n);
      return { w: l.total + 24, h: 62 };
    }
    case 'spiral':
      return { w: 300, h: 330 };
    case 'bubble':
      return { w: pieceLength(p) + 30, h: 40 };
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
      return { w: pieceLength(p) + 16, h: 28 };
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

export function getPieceSprite(p: Piece, scale = spriteScale, front = false): Sprite {
  const key = `${p.defId}|${p.color}|${p.len}|${p.variant}|${scale}|${front}`;
  const hit = cache.get(key);
  if (hit) {
    // LRU: lo usado recientemente se queda al final de la cola.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const dims = spriteDims(p);
  const safeScale = Math.min(scale, 2048 / (Math.max(dims.w, dims.h) + PAD * 2));
  const s = front
    ? makeSprite(dims.w, dims.h, (ctx) => paintPieceFront(ctx, p), safeScale)
    : buildPieceSprite(p, dims.w, dims.h, safeScale);
  cache.set(key, s);
  piecePixels += s.canvas.width * s.canvas.height;
  trimCache();
  return s;
}

export function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, withFront = true) {
  const s = getPieceSprite(p);
  ctx.drawImage(s.canvas, -s.w / 2, -s.h / 2, s.w, s.h);
  if (withFront && hasPieceFront(p)) drawPieceFront(ctx, p);
}

function hasPieceFront(p: Piece): boolean {
  return p.defId === 'funnel' || p.defId === 'fan' || p.defId === 'splitter' || p.defId === 'meter';
}

export function drawPieceFront(ctx: CanvasRenderingContext2D, p: Piece) {
  const s = getPieceSprite(p, spriteScale, true);
  ctx.drawImage(s.canvas, -s.w / 2, -s.h / 2, s.w, s.h);
}

function paintPieceFront(ctx: CanvasRenderingContext2D, p: Piece) {
  if (p.defId === 'splitter' || p.defId === 'meter') {
    channelPath(ctx, p.defId === 'splitter');
    ctx.strokeStyle = p.defId === 'splitter' ? 'rgba(177,239,209,0.27)' : 'rgba(184,216,255,0.3)';
    ctx.lineWidth = 57;
    ctx.lineCap = 'butt';
    ctx.stroke();
    const outlets = p.defId === 'splitter' ? [-SPLITTER_EXIT_X, SPLITTER_EXIT_X] : [0];
    for (const x of outlets) {
      ctx.beginPath();
      ctx.ellipse(x, CHANNEL_EXIT, 31, 8, 0, 0, Math.PI);
      ctx.strokeStyle = '#D8E9DF';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(0, CHANNEL_ENTRY, 32, 9, 0, 0, Math.PI);
    ctx.strokeStyle = '#D8E9DF';
    ctx.lineWidth = 4;
    ctx.stroke();
    if (p.defId === 'meter') chromeCap(ctx, -35, 18, 70, 10, 4);
  } else if (p.defId === 'funnel') {
    const { left, right } = funnelLayout(p);
    const half = -left[0].x;
    const top = left[0].y;
    const color = colorFor(p);
    const glass = ctx.createLinearGradient(-half, top, half, 74);
    glass.addColorStop(0, rgba(color, 0.62));
    glass.addColorStop(0.27, rgba(color, 0.32));
    glass.addColorStop(0.53, 'rgba(255,255,255,0.12)');
    glass.addColorStop(0.82, rgba(color, 0.40));
    glass.addColorStop(1, rgba(color, 0.64));
    ctx.beginPath();
    ctx.ellipse(0, top, half, 13, 0, 0, Math.PI);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    ctx.quadraticCurveTo(0, 101, right[right.length - 1].x, right[right.length - 1].y);
    for (let i = right.length - 2; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = glass;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, top, half, 13, 0, 0, Math.PI);
    ink(ctx, 5);
    ctx.stroke();
    ctx.strokeStyle = mix(color, '#FFFFFF', 0.68);
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 84, 40, 8, 0, 0, Math.PI);
    ink(ctx, 9);
    ctx.stroke();
    ctx.strokeStyle = chromeGrad(ctx, 84, 93);
    ctx.lineWidth = 5.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left[1].x + 7, left[1].y);
    ctx.quadraticCurveTo(left[3].x + 6, 14, left[5].x + 8, 65);
    ctx.strokeStyle = 'rgba(255,255,255,0.61)';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const glass = ctx.createLinearGradient(-FAN_HALF, 0, FAN_HALF, 0);
    glass.addColorStop(0, 'rgba(105,193,201,0.34)');
    glass.addColorStop(0.28, 'rgba(222,255,247,0.13)');
    glass.addColorStop(0.72, 'rgba(154,229,224,0.06)');
    glass.addColorStop(1, 'rgba(78,176,182,0.38)');
    ctx.fillStyle = glass;
    rr(ctx, -48, FAN_OUTLET + 10, 96, 188, 21);
    ctx.fill();
    ctx.strokeStyle = 'rgba(241,255,253,0.57)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-38, FAN_OUTLET + 31);
    ctx.lineTo(-38, 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, FAN_OUTLET + 4, 49, 13, 0, 0, Math.PI);
    ink(ctx, 8);
    ctx.stroke();
    ctx.strokeStyle = chromeGrad(ctx, FAN_OUTLET + 5, FAN_OUTLET + 20);
    ctx.lineWidth = 5;
    ctx.stroke();
    fillPath(ctx, (c2) => rr(c2, -FAN_HALF, 101, FAN_HALF * 2, 14, 6), bodyGrad(ctx, '#469CA2', 101, 115), 2);
    gloss(ctx, -42, 103, 84, 2, 1, 0.45);
  }
}

function channelPath(ctx: CanvasRenderingContext2D, split: boolean) {
  ctx.beginPath();
  ctx.moveTo(0, CHANNEL_ENTRY);
  if (!split) {
    ctx.lineTo(0, CHANNEL_EXIT);
    return;
  }
  ctx.lineTo(0, -26);
  for (const side of [-1, 1]) {
    ctx.moveTo(0, -26);
    ctx.bezierCurveTo(0, 3, side * 48, 23, side * SPLITTER_EXIT_X, CHANNEL_EXIT);
  }
}

/**
 * Sombra de contacto: la silueta de la pieza, sin luz ni brillos, desenfocada.
 * Se hornea a media resolución (una sombra suave no necesita más) y se dibuja
 * una sola vez por pieza, en espacio mundo.
 */
export function getPieceShadow(p: Piece): Sprite {
  const key = `${p.defId}|${p.len}|${p.variant}`;
  const hit = shadowCache.get(key);
  if (hit) {
    shadowCache.delete(key);
    shadowCache.set(key, hit);
    return hit;
  }
  const s = getPieceSprite(p);
  const half = makeCanvas(s.w / 2, s.h / 2);
  half.getContext('2d')!.drawImage(s.canvas, 0, 0, half.width, half.height);
  const soft = blurCanvas(silhouette(half, '#101C2C'), 2);
  const shadow = { canvas: soft, w: s.w, h: s.h };
  shadowCache.set(key, shadow);
  shadowPixels += soft.width * soft.height;
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

function buildPieceSprite(p: Piece, ww: number, hh: number, scale = spriteScale): Sprite {
  return makeSprite(ww, hh, (ctx) => {
    const c = colorFor(p);

    if (p.defId === 'ramp') {
      const L = p.len;
      const half = L / 2;
      fillPath(ctx, (c2) => rr(c2, -half, -11, L, 22, 11), tubeGrad(ctx, c, -11, 11), 3);
      gloss(ctx, -half + 9, -8.4, L - 18, 5.8, 2.9, 0.5);
      ctx.fillStyle = 'rgba(18,36,58,0.14)';
      rr(ctx, -half + 9, 3.6, L - 18, 5.2, 2.6);
      ctx.fill();
      // Topes cromados en los dos extremos.
      chromeCap(ctx, -half - 5, -12.5, 20, 25, 9);
      chromeCap(ctx, half - 15, -12.5, 20, 25, 9);
    } else if (p.defId === 'rampCurve') {
      const R = RAMP_CURVE_RADIUS;
      const a0 = RAMP_CURVE_START;
      const a1 = RAMP_CURVE_END;
      const RIB = 10;
      const band = (c2: CanvasRenderingContext2D) => {
        c2.arc(0, 0, R + RIB, a0, a1);
        c2.arc(0, 0, R - RIB, a1, a0, true);
        c2.closePath();
      };
      const bandGrad = ctx.createRadialGradient(0, 0, R - RIB, 0, 0, R + RIB);
      bandGrad.addColorStop(0, mix(c, '#0E1B2C', 0.2));
      bandGrad.addColorStop(0.22, c);
      bandGrad.addColorStop(0.52, mix(c, '#FFFFFF', 0.26));
      bandGrad.addColorStop(0.82, c);
      bandGrad.addColorStop(1, mix(c, '#FFFFFF', 0.12));
      fillPath(ctx, band, bandGrad, 2.8);
      // Brillo a lo largo del canto exterior.
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, R + 4, a0 + 0.12, a1 - 0.1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(18,36,58,0.14)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, R - 4.4, a0 + 0.1, a1 - 0.12);
      ctx.stroke();
      // Topes cromados en los extremos del arco.
      for (const ang of [a0, a1]) {
        const x = Math.cos(ang) * R;
        const y = Math.sin(ang) * R;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        chromeCap(ctx, -12, -9, 24, 18, 9);
        ctx.restore();
      }
    } else if (p.defId === 'balance') {
      const L = 122;
      fillPath(ctx, (c2) => rr(c2, -L, -11, L * 2, 22, 11), tubeGrad(ctx, c, -11, 11), 3);
      gloss(ctx, -L + 9, -8.4, L * 2 - 18, 5.8, 2.9, 0.5);
      chromeCap(ctx, -L - 5, -12.5, 20, 25, 9);
      chromeCap(ctx, L - 15, -12.5, 20, 25, 9);
      // Eje central: disco cromado con anillo de color y perno.
      fillPath(ctx, (c2) => {
        c2.arc(0, 0, 24, 0, TAU);
      }, chromeGrad(ctx, -24, 24), 2.8);
      fillPath(ctx, (c2) => {
        c2.arc(0, 0, 14, 0, TAU);
      }, bodyGrad(ctx, c, -14, 14), 2.2);
      stud(ctx, 0, 0, 6);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 19, Math.PI * 0.95, Math.PI * 1.55);
      ctx.stroke();
    } else if (p.defId === 'conveyor') {
      const L = Math.max(80, pieceLength(p));
      const half = L / 2;
      fillPath(ctx, (c2) => rr(c2, -half, -13, L, 26, 13), bodyGrad(ctx, '#3C5A78', -13, 13), 2.8);
      fillPath(ctx, (c2) => rr(c2, -half + 11, -7.5, L - 22, 15, 7.5), '#16273B', 1.8);
      // Rodillos cromados.
      for (const x of [-half + 10, half - 10]) {
        fillPath(ctx, (c2) => {
          c2.arc(x, 0, 8.4, 0, TAU);
        }, chromeGrad(ctx, -8, 8), 2.2);
        ctx.fillStyle = '#26384E';
        ctx.beginPath();
        ctx.arc(x, 0, 2.6, 0, TAU);
        ctx.fill();
      }
      // Flechas de la cinta, repartidas a lo largo de la longitud actual.
      const n = Math.max(2, Math.round((L - 70) / 52));
      const stepArrow = (L - 64) / (n - 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < n; i++) {
        const x = -half + 32 + i * stepArrow;
        ctx.beginPath();
        ctx.moveTo(x - 6, -3.8);
        ctx.lineTo(x + 3, 0);
        ctx.lineTo(x - 6, 3.8);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-half + 22, -9.4);
      ctx.lineTo(half - 22, -9.4);
      ctx.stroke();
    } else if (p.defId === 'sTrack') {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const path = (offset: number) => {
        ctx.beginPath();
        ctx.moveTo(S_TRACK[0].x, S_TRACK[0].y + offset);
        for (const point of S_TRACK.slice(1)) ctx.lineTo(point.x, point.y + offset);
      };
      path(4);
      ink(ctx, 24);
      ctx.stroke();
      path(3);
      ctx.strokeStyle = tubeGrad(ctx, c, -45, 50);
      ctx.lineWidth = 20;
      ctx.stroke();
      path(-5);
      ctx.strokeStyle = 'rgba(255,255,255,0.66)';
      ctx.lineWidth = 2.6;
      ctx.stroke();
      for (const { x, y } of [S_TRACK[0], S_TRACK[S_TRACK.length - 1]]) {
        chromeCap(ctx, x - 7, y - 10, 14, 24, 5);
      }
    } else if (p.defId === 'funnel') {
      const { left: L, right: R } = funnelLayout(p);
      const topHalf = -L[0].x;
      const glass = ctx.createLinearGradient(0, -89, 0, 88);
      glass.addColorStop(0, mix(c, '#172D43', 0.66));
      glass.addColorStop(0.37, mix(c, '#FFFFFF', 0.46));
      glass.addColorStop(0.73, mix(c, '#FFFFFF', 0.34));
      glass.addColorStop(1, mix(c, '#182C41', 0.4));
      fillPath(ctx, (c2) => {
        c2.ellipse(0, L[0].y, topHalf, 13, 0, 0, Math.PI, true);
        for (let i = 1; i < L.length; i++) c2.lineTo(L[i].x, L[i].y);
        c2.quadraticCurveTo(0, 68, R[R.length - 1].x, R[R.length - 1].y);
        for (let i = R.length - 2; i >= 0; i--) c2.lineTo(R[i].x, R[i].y);
        c2.closePath();
      }, glass, 3);
      ctx.beginPath();
      ctx.ellipse(0, L[0].y, topHalf, 13, 0, Math.PI, TAU);
      ctx.strokeStyle = mix(c, '#FFFFFF', 0.52);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#203648';
      ctx.beginPath();
      ctx.ellipse(0, 84, 40, 8, 0, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'bumper') {
      fillPath(ctx, (c2) => {
        c2.arc(0, 0, 30, 0, TAU);
      }, bodyGrad(ctx, c, -30, 30), 3);
      // Aro cromado interior.
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, TAU);
      ink(ctx, 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, TAU);
      ctx.strokeStyle = chromeGrad(ctx, -19, 19);
      ctx.lineWidth = 7.6;
      ctx.stroke();
      fillPath(ctx, (c2) => {
        c2.arc(0, 0, 10, 0, TAU);
      }, bodyGrad(ctx, c, -10, 10), 2.2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(-11, -12, 7, 4.2, -0.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 24, Math.PI * 1.08, Math.PI * 1.5);
      ctx.stroke();
    } else if (p.defId === 'booster') {
      fillPath(ctx, (c2) => rr(c2, -40, -40, 80, 80, 18), bodyGrad(ctx, c, -44, 44), 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.38)';
      ctx.lineWidth = 2;
      rr(ctx, -32, -32, 64, 64, 14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 5.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const x of [-18, 0, 18]) {
        ctx.beginPath();
        ctx.moveTo(x - 7, -11);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x - 7, 11);
        ctx.stroke();
      }
      gloss(ctx, -32, -33, 46, 9, 4.5, 0.2);
    } else if (p.defId === 'cannon') {
      // Base y placa de apoyo.
      fillPath(ctx, (c2) => rr(c2, -40, 2, 80, 20, 9), bodyGrad(ctx, c, 2, 22), 3);
      gloss(ctx, -34, 4.5, 68, 4, 2, 0.4);
      fillPath(ctx, (c2) => rr(c2, -30, -6, 60, 12, 5), bodyGrad(ctx, c, -6, 6), 2.4);
      // Muelle: espiras cromadas apiladas.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(0, -2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const y = -11 - i * 6.2;
        const rx = 16 - i * 0.9;
        ctx.beginPath();
        ctx.ellipse(0, y, rx, 4.4, 0, 0, TAU);
        ink(ctx, 5.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, y, rx, 4.4, 0, 0, TAU);
        ctx.strokeStyle = chromeGrad(ctx, y - 4.4, y + 4.4);
        ctx.lineWidth = 3.1;
        ctx.stroke();
      }
      // Tapa superior.
      chromeCap(ctx, -19, -38, 38, 13, 6);
      gloss(ctx, -15, -36, 30, 3.4, 1.7, 0.55);
    } else if (p.defId === 'star') {
      const g = ctx.createLinearGradient(0, -20, 0, 20);
      g.addColorStop(0, '#FFE79A');
      g.addColorStop(0.48, c);
      g.addColorStop(1, mix(c, '#8A5A12', 0.34));
      star(ctx, 0, 0, 20, 9.2, g);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      ctx.arc(-5.5, -6.5, 3.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(14, -16);
      ctx.lineTo(14, -9);
      ctx.moveTo(10.5, -12.5);
      ctx.lineTo(17.5, -12.5);
      ctx.stroke();
    } else if (p.defId === 'goal') {
      // Cuerpo de la campana.
      const bell = (c2: CanvasRenderingContext2D) => {
        c2.moveTo(-43, 26);
        c2.bezierCurveTo(-43, -12, -29, -41, 0, -41);
        c2.bezierCurveTo(29, -41, 43, -12, 43, 26);
        c2.quadraticCurveTo(0, 41, -43, 26);
        c2.closePath();
      };
      fillPath(ctx, bell, bodyGrad(ctx, c, -41, 41), 3);
      gloss(ctx, -31, -30, 20, 34, 10, 0.24);
      // Tirador cromado.
      fillPath(ctx, (c2) => {
        c2.arc(0, -49, 9, 0, TAU);
        c2.rect(-3.4, -44, 6.8, 7);
      }, chromeGrad(ctx, -58, -37), 2.6);
      // Abertura y badajo.
      fillPath(ctx, (c2) => {
        c2.ellipse(0, 24, 32, 9.5, 0, 0, TAU);
      }, '#3A2A13', 2.6);
      ctx.fillStyle = '#22170A';
      ctx.beginPath();
      ctx.ellipse(0, 24, 26, 6, 0, 0, TAU);
      ctx.fill();
      fillPath(ctx, (c2) => {
        c2.arc(0, 35, 5.6, 0, TAU);
      }, chromeGrad(ctx, 29, 41), 1.8);
      // Asas laterales.
      for (const sx of [-1, 1]) {
        fillPath(ctx, (c2) => {
          c2.arc(sx * 45, 18, 5.6, 0, TAU);
        }, chromeGrad(ctx, 12, 24), 2);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(-15, -12, 18, Math.PI * 1.05, Math.PI * 1.6);
      ctx.stroke();
    } else if (p.defId === 'spiral') {
      const N = 190;
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
      const RIB = 15;
      const groups: { back: boolean; a: number; b: number }[] = [];
      let start = 0;
      for (let i = 1; i <= N; i++) {
        if ((pts[i].d < 0) !== (pts[start].d < 0)) {
          groups.push({ back: pts[start].d < 0, a: start, b: i });
          start = i;
        }
      }
      groups.push({ back: pts[start].d < 0, a: start, b: N });

      const pathFor = (band: typeof groups[number]) => {
        ctx.beginPath();
        const n0 = normalAt(band.a);
        ctx.moveTo(pts[band.a].x + n0.x * RIB, pts[band.a].y + n0.y * RIB);
        for (let i = band.a + 1; i <= band.b; i++) {
          const n = normalAt(i);
          ctx.lineTo(pts[i].x + n.x * RIB, pts[i].y + n.y * RIB);
        }
        for (let i = band.b; i >= band.a; i--) {
          const n = normalAt(i);
          ctx.lineTo(pts[i].x - n.x * RIB, pts[i].y - n.y * RIB);
        }
        ctx.closePath();
      };

      const frontGrad = (() => {
        const g = ctx.createLinearGradient(0, -125, 0, 165);
        g.addColorStop(0, '#F0FBFF');
        g.addColorStop(0.22, '#A9DFF2');
        g.addColorStop(0.55, '#7CC8E8');
        g.addColorStop(0.84, '#4B9FCB');
        g.addColorStop(1, '#357FAB');
        return g;
      })();
      const backGrad = (() => {
        const g = ctx.createLinearGradient(0, -125, 0, 165);
        g.addColorStop(0, '#7FA9C2');
        g.addColorStop(0.5, '#4C7E9C');
        g.addColorStop(1, '#2F5A76');
        return g;
      })();

      const paintGroup = (band: typeof groups[number], back: boolean) => {
        pathFor(band);
        ctx.fillStyle = back ? backGrad : frontGrad;
        ctx.fill();
        // Se trazan solo los dos cantos largos: cerrar el contorno dibujaría
        // una costura transversal en cada cambio de profundidad.
        ctx.beginPath();
        const e0 = normalAt(band.a);
        ctx.moveTo(pts[band.a].x + e0.x * RIB, pts[band.a].y + e0.y * RIB);
        for (let i = band.a + 1; i <= band.b; i++) {
          const n = normalAt(i);
          ctx.lineTo(pts[i].x + n.x * RIB, pts[i].y + n.y * RIB);
        }
        ink(ctx, back ? 2.4 : 3.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pts[band.a].x - e0.x * RIB, pts[band.a].y - e0.y * RIB);
        for (let i = band.a + 1; i <= band.b; i++) {
          const n = normalAt(i);
          ctx.lineTo(pts[i].x - n.x * RIB, pts[i].y - n.y * RIB);
        }
        ctx.stroke();
        if (!back) {
          // Brillo longitudinal y sombra del canto interior.
          ctx.beginPath();
          const n0 = normalAt(band.a);
          ctx.moveTo(pts[band.a].x + n0.x * 6, pts[band.a].y + n0.y * 6);
          for (let i = band.a + 1; i <= band.b; i++) {
            const n = normalAt(i);
            ctx.lineTo(pts[i].x + n.x * 6, pts[i].y + n.y * 6);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 2.4;
          ctx.lineCap = 'round';
          ctx.stroke();
          ctx.beginPath();
          const m0 = normalAt(band.a);
          ctx.moveTo(pts[band.a].x - m0.x * 10, pts[band.a].y - m0.y * 10);
          for (let i = band.a + 1; i <= band.b; i++) {
            const n = normalAt(i);
            ctx.lineTo(pts[i].x - n.x * 10, pts[i].y - n.y * 10);
          }
          ctx.strokeStyle = 'rgba(18,44,70,0.2)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      };

      for (const band of groups) if (band.back) paintGroup(band, true);
      // Sombra proyectada de los tramos delanteros: separa los cruces.
      ctx.save();
      ctx.translate(2.4, 3.6);
      ctx.fillStyle = 'rgba(12,30,52,0.24)';
      for (const band of groups) {
        if (band.back) continue;
        pathFor(band);
        ctx.fill();
      }
      ctx.restore();
      for (const band of groups) if (!band.back) paintGroup(band, false);

      // Láminas musicales con aro cromado.
      for (let i = 0; i < 7; i++) {
        const t = (i + 1) / 8;
        const lo = spiralLocal(t);
        const col = NOTE_COLORS[i + 1] ?? NOTE_COLORS[0];
        fillPath(ctx, (c2) => {
          c2.arc(lo.x, lo.y, 8.4, 0, TAU);
        }, chromeGrad(ctx, lo.y - 8, lo.y + 8), 2);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(lo.x, lo.y, 5.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath();
        ctx.arc(lo.x - 1.8, lo.y - 2, 1.7, 0, TAU);
        ctx.fill();
      }

      // Boca de entrada con aro cromado, apoyada sobre el primer tramo.
      const entry = spiralLocal(0.012);
      ctx.save();
      ctx.translate(entry.x, entry.y);
      ctx.rotate(0.2);
      fillPath(ctx, (c2) => {
        c2.ellipse(0, 0, 30, 16, 0, 0, TAU);
      }, (() => {
        const g = ctx.createLinearGradient(0, -16, 0, 16);
        g.addColorStop(0, '#F4FDFF');
        g.addColorStop(0.45, '#BFE9F8');
        g.addColorStop(1, '#6FB6D4');
        return g;
      })(), 2.8);
      fillPath(ctx, (c2) => {
        c2.ellipse(0, 0, 23, 10, 0, 0, TAU);
      }, (() => {
        const g = ctx.createLinearGradient(0, -10, 0, 10);
        g.addColorStop(0, '#DFF6FF');
        g.addColorStop(1, '#4E9FC4');
        return g;
      })(), 2.2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(-3, -3, 18, 6.5, 0, Math.PI * 0.95, Math.PI * 1.72);
      ctx.stroke();
      ctx.restore();

      // Salida.
      const out = spiralLocal(1);
      fillPath(ctx, (c2) => {
        c2.arc(out.x, out.y + 4, 11, 0, TAU);
      }, chromeGrad(ctx, out.y - 6, out.y + 14), 2.4);
      ctx.fillStyle = '#4B9FCB';
      ctx.beginPath();
      ctx.arc(out.x, out.y + 4, 5.6, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'bubble') {
      const sx = Math.max(0.5, pieceLength(p) / 220);
      ctx.save();
      ctx.scale(sx, 1);
      const shape = (c2: CanvasRenderingContext2D) => {
        c2.moveTo(-112, -6);
        c2.lineTo(-86, -9);
        c2.lineTo(-52, -7);
        c2.lineTo(-18, -10);
        c2.lineTo(16, -7);
        c2.lineTo(54, -9);
        c2.lineTo(84, -6);
        c2.lineTo(112, -8);
        c2.lineTo(114, 6);
        c2.lineTo(82, 4);
        c2.lineTo(44, 8);
        c2.lineTo(10, 5);
        c2.lineTo(-24, 8);
        c2.lineTo(-60, 5);
        c2.lineTo(-94, 8);
        c2.lineTo(-114, 5);
        c2.closePath();
      };
      const ice = ctx.createLinearGradient(0, -10, 0, 8);
      ice.addColorStop(0, 'rgba(249,255,255,0.96)');
      ice.addColorStop(0.38, 'rgba(186,236,255,0.92)');
      ice.addColorStop(1, 'rgba(96,176,222,0.9)');
      fillPath(ctx, shape, ice, 2.6);
      // Facetas.
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(-112, -6);
      ctx.lineTo(-86, -9);
      ctx.lineTo(-52, -7);
      ctx.lineTo(-70, -1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.beginPath();
      ctx.moveTo(16, -7);
      ctx.lineTo(54, -9);
      ctx.lineTo(84, -6);
      ctx.lineTo(62, 0);
      ctx.closePath();
      ctx.fill();
      // Aristas y grietas.
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.6;
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
      ctx.strokeStyle = 'rgba(42,100,145,0.42)';
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
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.3;
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
      // Escarcha.
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 9; i++) {
        const x = -100 + i * 25;
        const y = (i % 2 === 0 ? -4 : 4) + (i % 3);
        ctx.beginPath();
        ctx.arc(x, y, 0.9 + (i % 2), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    } else if (p.defId === 'bubbleLift') {
      // Base cromada.
      chromeCap(ctx, -38, 50, 76, 18, 9);
      fillPath(ctx, (c2) => rr(c2, -28, 43, 56, 12, 6), bodyGrad(ctx, c, 43, 55), 2.2);
      // Collarines laterales.
      for (const side of [-1, 1]) {
        fillPath(ctx, (c2) => rr(c2, side * 48 - 8, -8, 16, 16, 5), chromeGrad(ctx, -8, 8), 2.2);
      }
      // Aro de la fábrica.
      ctx.beginPath();
      ctx.ellipse(0, 0, 48, 48, 0, 0, TAU);
      ink(ctx, 13);
      ctx.stroke();
      const ringGrad = ctx.createLinearGradient(0, -48, 0, 48);
      ringGrad.addColorStop(0, '#8FE0D9');
      ringGrad.addColorStop(0.4, mix(c, '#FFFFFF', 0.12));
      ringGrad.addColorStop(1, mix(c, '#0E1B2C', 0.28));
      ctx.beginPath();
      ctx.ellipse(0, 0, 48, 48, 0, 0, TAU);
      ctx.strokeStyle = ringGrad;
      ctx.lineWidth = 9;
      ctx.stroke();
      // Película iridiscente.
      const film = ctx.createLinearGradient(-42, -42, 42, 42);
      film.addColorStop(0, 'rgba(143,211,238,0.6)');
      film.addColorStop(0.32, 'rgba(255,255,255,0.16)');
      film.addColorStop(0.52, 'rgba(210,109,140,0.36)');
      film.addColorStop(0.72, 'rgba(233,180,76,0.3)');
      film.addColorStop(1, 'rgba(79,157,105,0.36)');
      ctx.fillStyle = film;
      ctx.beginPath();
      ctx.ellipse(0, 0, 43, 43, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, 41, -2.4, -0.75);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0.55, 2.35);
      ctx.stroke();
      // Pompas.
      const bubbles: [number, number, number][] = [[-28, -68, 7], [18, -80, 9], [36, -62, 5], [-4, -94, 4]];
      for (const [bx, by, br] of bubbles) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(bx - br * 0.3, by - br * 0.35, Math.max(1, br * 0.22), 0, TAU);
        ctx.fill();
      }
    } else if (p.defId === 'marbleFactory') {
      // Patas cromadas.
      fillPath(ctx, (c2) => rr(c2, -46, 46, 24, 20, 6), chromeGrad(ctx, 46, 66), 2.4);
      fillPath(ctx, (c2) => rr(c2, 22, 46, 24, 20, 6), chromeGrad(ctx, 46, 66), 2.4);
      // Cuerpo principal.
      fillPath(ctx, (c2) => rr(c2, -44, -18, 88, 68, 15), bodyGrad(ctx, c, -18, 50), 3);
      // Panel frontal.
      fillPath(ctx, (c2) => rr(c2, -33, 1, 58, 40, 10), mix(c, '#0E1B2C', 0.34), 2.2);
      // Engranajes cromados.
      const gear = (gx: number, gy: number, rad: number) => {
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
        ctx.fillStyle = chromeGrad(ctx, gy - rad, gy + rad);
        ctx.fill();
        ink(ctx, 1.8);
        ctx.stroke();
        ctx.fillStyle = '#2B2D33';
        ctx.beginPath();
        ctx.arc(gx, gy, rad * 0.24, 0, TAU);
        ctx.fill();
      };
      gear(-14, 21, 9);
      gear(9, 26, 7);
      gear(15, 9, 5);
      // Boquilla de salida.
      chromeCap(ctx, -14, 47, 28, 18, 6);
      ctx.fillStyle = '#14283F';
      ctx.beginPath();
      ctx.ellipse(0, 63, 11, 4.2, 0, 0, TAU);
      ctx.fill();
      // Cuello y tolva.
      fillPath(ctx, (c2) => rr(c2, -31, -32, 62, 18, 8), chromeGrad(ctx, -32, -14), 2.6);
      // Globo de cristal con canicas.
      const globeY = -58;
      const globeR = 34;
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, globeY, globeR, 0, TAU);
      ctx.clip();
      const gl = ctx.createRadialGradient(-12, globeY - 14, 3, 0, globeY, globeR);
      gl.addColorStop(0, 'rgba(240,252,255,0.9)');
      gl.addColorStop(0.55, 'rgba(180,230,248,0.5)');
      gl.addColorStop(1, 'rgba(116,188,218,0.68)');
      ctx.fillStyle = gl;
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
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(0, globeY, globeR, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Aro cromado del globo.
      ctx.beginPath();
      ctx.arc(0, globeY, globeR + 1, 0, TAU);
      ink(ctx, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, globeY, globeR + 1, 0, TAU);
      ctx.strokeStyle = chromeGrad(ctx, globeY - globeR, globeY + globeR);
      ctx.lineWidth = 4.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, globeY, globeR - 7, -2.4, -1.15);
      ctx.stroke();
      // Zócalo de la lucecita de estado (el color lo pinta el renderer).
      fillPath(ctx, (c2) => {
        c2.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 8, 0, TAU);
      }, '#2B2D33', 2);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(FACTORY_LAMP.x, FACTORY_LAMP.y, 5.2, 0, TAU);
      ctx.fill();
    } else if (p.defId === 'portal') {
      const ring = (x: number, col: string) => {
        ctx.save();
        ctx.translate(x, 0);
        // Halo.
        ctx.fillStyle = rgba(col, 0.14);
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, TAU);
        ctx.fill();
        // Aro cromado exterior.
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, TAU);
        ink(ctx, 15);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, TAU);
        ctx.strokeStyle = chromeGrad(ctx, -26, 26);
        ctx.lineWidth = 11;
        ctx.stroke();
        // Aro interior de color.
        ctx.beginPath();
        ctx.arc(0, 0, 25.4, 0, TAU);
        ctx.strokeStyle = bodyGrad(ctx, col, -26, 26);
        ctx.lineWidth = 5;
        ctx.stroke();
        // Fondo profundo.
        const hole = ctx.createRadialGradient(-6, -7, 2, 0, 0, 21);
        hole.addColorStop(0, mix(col, '#FFFFFF', 0.35));
        hole.addColorStop(0.45, mix(col, '#0E1B2C', 0.55));
        hole.addColorStop(1, '#0C1B2C');
        fillPath(ctx, (c2) => {
          c2.arc(0, 0, 20, 0, TAU);
        }, hole, 2.4);
        // Reflejos.
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(-5, -6, 20.5, Math.PI * 0.95, Math.PI * 1.5);
        ctx.stroke();
        ctx.strokeStyle = rgba(col, 0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 13, -0.3, 2.0);
        ctx.stroke();
        ctx.restore();
      };
      const half = p.len > 0 ? p.len / 2 : 62;
      const inner = Math.max(8, half - 30);
      // Vínculo discontinuo.
      ctx.strokeStyle = 'rgba(30,58,92,0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(-half + 27, 0);
      ctx.quadraticCurveTo(0, -Math.min(24, inner * 0.8), half - 27, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const px = -half + 27 + (half * 2 - 54) * t;
        const py = -Math.min(24, inner * 0.8) * 2 * t * (1 - t);
        ctx.fillStyle = 'rgba(30,58,92,0.35)';
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, TAU);
        ctx.fill();
      }
      ring(-half, PALETTE.purple);
      ring(half, PALETTE.teal);
    } else if (p.defId === 'splitter' || p.defId === 'meter') {
      const split = p.defId === 'splitter';
      channelPath(ctx, split);
      ink(ctx, 71);
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.strokeStyle = bodyGrad(ctx, split ? PALETTE.teal : PALETTE.purple, CHANNEL_ENTRY, CHANNEL_EXIT);
      ctx.lineWidth = 66;
      ctx.stroke();
      ctx.strokeStyle = split ? '#416976' : '#405474';
      ctx.lineWidth = 54;
      ctx.stroke();
      fillPath(ctx, (c2) => c2.ellipse(0, CHANNEL_ENTRY, 33, 10, 0, 0, TAU), '#30495B', 2.4);
      for (const x of split ? [-SPLITTER_EXIT_X, SPLITTER_EXIT_X] : [0]) {
        fillPath(ctx, (c2) => c2.ellipse(x, CHANNEL_EXIT, 31, 8, 0, 0, TAU), '#30495B', 2.4);
      }
    } else if (p.defId === 'fan') {
      const air = ctx.createLinearGradient(0, FAN_OUTLET, 0, 102);
      air.addColorStop(0, 'rgba(184,230,222,0.38)');
      air.addColorStop(0.6, 'rgba(83,172,184,0.25)');
      air.addColorStop(1, 'rgba(45,102,125,0.65)');
      fillPath(ctx, (c2) => rr(c2, -48, FAN_OUTLET + 3, 96, 185, 21), air, 2.3);
      fillPath(ctx, (c2) => c2.ellipse(0, FAN_OUTLET + 4, 49, 13, 0, 0, TAU), '#31536B', 2.5);
      ctx.beginPath();
      ctx.ellipse(0, FAN_OUTLET + 4, 49, 13, 0, Math.PI, TAU);
      ctx.strokeStyle = '#C1D8D7';
      ctx.lineWidth = 4;
      ctx.stroke();
      fillPath(ctx, (c2) => c2.ellipse(0, 99, FAN_HALF, 12, 0, 0, TAU), '#284A58', 2.4);
      for (const x of [-27, -14, 0, 14, 27]) {
        ctx.beginPath();
        ctx.moveTo(x + 5, 95);
        ctx.lineTo(x - 5, 102);
        ctx.strokeStyle = '#80BCBB';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    } else if (p.defId === 'electromagnet') {
      const horseshoe = (c2: CanvasRenderingContext2D) => {
        c2.moveTo(-24, -30);
        c2.lineTo(-24, 4);
        c2.quadraticCurveTo(-24, 30, 0, 30);
        c2.quadraticCurveTo(24, 30, 24, 4);
        c2.lineTo(24, -30);
      };
      // Contorno de tinta, cuerpo cromado y brillo.
      ctx.beginPath();
      horseshoe(ctx);
      ink(ctx, 26);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      horseshoe(ctx);
      ctx.strokeStyle = chromeGrad(ctx, -30, 30);
      ctx.lineWidth = 20;
      ctx.stroke();
      ctx.beginPath();
      horseshoe(ctx);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 5;
      ctx.stroke();
      // Polos de color.
      for (const [x, col] of [[-36, PALETTE.red], [14, PALETTE.blue]] as [number, string][]) {
        fillPath(ctx, (c2) => rr(c2, x, -40, 22, 20, 5), bodyGrad(ctx, col, -40, -20), 2.4);
        gloss(ctx, x + 3, -37, 16, 4, 2, 0.4);
      }
      // Bobina de cobre.
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 7, 19 + i * 5, Math.PI * 0.18, Math.PI * 0.82);
        ink(ctx, 5.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 7, 19 + i * 5, Math.PI * 0.18, Math.PI * 0.82);
        ctx.strokeStyle = '#D28A45';
        ctx.lineWidth = 3.4;
        ctx.stroke();
      }
    } else if (p.defId === 'hourglass') {
      // Tapas de madera con veta y remaches cromados.
      for (const y of [-62, 48]) {
        fillPath(ctx, (c2) => rr(c2, -34, y, 68, 14, 6), (() => {
          const g = ctx.createLinearGradient(0, y, 0, y + 14);
          g.addColorStop(0, mix(PALETTE.wood, '#FFFFFF', 0.4));
          g.addColorStop(0.5, PALETTE.wood);
          g.addColorStop(1, PALETTE.woodDark);
          return g;
        })(), 2.6);
        grain(ctx, -32, y + 2.5, 64, 9);
        stud(ctx, -26, y + 7, 2.4);
        stud(ctx, 26, y + 7, 2.4);
      }
      // Vidrio.
      const glass = ctx.createLinearGradient(0, -46, 0, 46);
      glass.addColorStop(0, 'rgba(236,251,255,0.95)');
      glass.addColorStop(0.5, 'rgba(190,232,246,0.75)');
      glass.addColorStop(1, 'rgba(138,200,222,0.85)');
      fillPath(ctx, (c2) => {
        c2.moveTo(-22, -46);
        c2.lineTo(22, -46);
        c2.lineTo(3, -2);
        c2.lineTo(22, 46);
        c2.lineTo(-22, 46);
        c2.lineTo(-3, -2);
        c2.closePath();
      }, glass, 2.6);
      // Arena dorada.
      fillPath(ctx, (c2) => {
        c2.moveTo(-17, -42);
        c2.lineTo(17, -42);
        c2.lineTo(1, -19);
        c2.lineTo(-1, -19);
        c2.closePath();
      }, (() => {
        const g = ctx.createLinearGradient(0, -42, 0, -19);
        g.addColorStop(0, '#FFD98A');
        g.addColorStop(1, '#E8A63C');
        return g;
      })(), 1.8);
      fillPath(ctx, (c2) => {
        c2.moveTo(-19, 42);
        c2.lineTo(19, 42);
        c2.lineTo(0, 25);
        c2.closePath();
      }, (() => {
        const g = ctx.createLinearGradient(0, 25, 0, 42);
        g.addColorStop(0, '#F6BE5C');
        g.addColorStop(1, '#D99330');
        return g;
      })(), 1.8);
      ctx.strokeStyle = 'rgba(233,180,76,0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -17);
      ctx.lineTo(0, 25);
      ctx.stroke();
      // Brillo del cristal.
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-15, -38);
      ctx.lineTo(-6, -8);
      ctx.moveTo(15, 36);
      ctx.lineTo(7, 12);
      ctx.stroke();
    } else if (p.defId === 'xylo5') {
      const n = 5;
      const layout = xyloLayout(n);
      // Base de madera con veta.
      fillPath(ctx, (c2) => rr(c2, -layout.total / 2 - 12, 8, layout.total + 24, 22, 9), (() => {
        const g = ctx.createLinearGradient(0, 8, 0, 30);
        g.addColorStop(0, mix(PALETTE.wood, '#FFFFFF', 0.4));
        g.addColorStop(0.5, PALETTE.wood);
        g.addColorStop(1, PALETTE.woodDark);
        return g;
      })(), 2.8);
      grain(ctx, -layout.total / 2 - 8, 11, layout.total + 16, 16);
      // Carril oscuro: los huecos entre láminas se leen como separación real.
      fillPath(ctx, (c2) => rr(c2, -layout.total / 2 - 7, 4, layout.total + 14, 9, 4), '#8A5626', 2);
      for (let i = 0; i < n; i++) {
        const w = layout.widths[i];
        const x = layout.xs[i];
        const col = NOTE_COLORS[i] ?? NOTE_COLORS[0];
        fillPath(ctx, (c2) => rr(c2, x - w / 2, -13, w, 18, 7), bodyGrad(ctx, col, -13, 5), 2.4);
        gloss(ctx, x - w / 2 + 5, -10.6, w - 10, 4.2, 2.1, 0.5);
        ctx.fillStyle = 'rgba(18,36,58,0.12)';
        rr(ctx, x - w / 2 + 6, 1.2, w - 12, 2.6, 1.3);
        ctx.fill();
        stud(ctx, x - w / 2 + 9, -4, 2.5);
        stud(ctx, x + w / 2 - 9, -4, 2.5);
      }
    }
  }, scale);
}

function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  fill: string | CanvasGradient,
  stroke?: string
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
  if (stroke) {
    ctx.strokeStyle = rgba(stroke, 0.25);
    ctx.lineWidth = 2;
  } else {
    ink(ctx, 2.6);
  }
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
  }, 3);
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, cw, ch);
  // Placa neutra: da contraste a las piezas claras (hielo, cristal, aire).
  ctx.fillStyle = 'rgba(38,62,92,0.055)';
  rr(ctx, 2, 2, cw - 4, ch - 4, Math.min(13, cw * 0.2));
  ctx.fill();
  if (kind === 'icon') {
    drawGlyph(ctx, itemId, cw / 2, ch / 2, Math.min(cw, ch) * 0.34);
    return;
  }
  if (kind === 'marble') {
    const type = MARBLE_TYPES.find((m) => m.id === itemId);
    if (!type) return;
    const r = Math.min(cw, ch) * 0.25;
    drawSoftShadow(ctx, cw / 2 + 2, ch / 2 + r * 0.95, r * 1.05, r * 0.38, 0.4);
    drawMarbleSprite(ctx, type, cw / 2, ch / 2 - r * 0.05, r);
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
  const s = getPieceSprite(p, 1);
  // Las piezas muy alargadas se recortan por los extremos: si se encogieran
  // hasta caber quedarían como una línea. El resto se muestra completo.
  const cropped =
    itemId === 'ramp' ||
    itemId === 'conveyor' ||
    itemId === 'balance' ||
    itemId === 'bubble' ||
    itemId.startsWith('xylo');
  const scale = cropped
    ? Math.min((ch - 20) / s.h, 3)
    : Math.min((cw - 14) / s.w, (ch - 20) / s.h, 2.4);
  const dw = s.w * scale;
  const dh = s.h * scale;
  drawSoftShadow(ctx, cw / 2 + 2, ch / 2 + dh * 0.34, dw * 0.3, Math.max(3, dh * 0.12), 0.34);
  const x = cw / 2 - dw / 2;
  const y = ch / 2 - dh / 2 - 1;
  ctx.drawImage(s.canvas, x, y, dw, dh);
  if (hasPieceFront(p)) ctx.drawImage(getPieceSprite(p, 1, true).canvas, x, y, dw, dh);
}

/** Pictograma del circuito: barato incluso si hay muchos talleres guardados. */
export function drawWorkshopPreview(canvas: HTMLCanvasElement, pieces: Piece[], paper: string) {
  canvas.width = 180;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 180, 96);
  ctx.fillStyle = 'rgba(29,55,64,0.13)';
  for (let x = 10; x < 180; x += 12) {
    for (let y = 10; y < 96; y += 12) ctx.fillRect(x, y, 1, 1);
  }
  if (!pieces.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pieces) {
    const { w, h } = pieceHitSize(p);
    const r = Math.hypot(w, h) / 2;
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
  }
  const zoom = Math.min(155 / (maxX - minX), 74 / (maxY - minY), 0.57);
  ctx.translate(90, 48);
  ctx.scale(zoom, zoom);
  ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  const step = Math.max(1, Math.ceil(pieces.length / 90));
  for (let i = 0; i < pieces.length; i += step) {
    const p = pieces[i];
    const { w, h } = pieceHitSize(p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = colorFor(p);
    rr(ctx, -w * 0.44, -h * 0.3, w * 0.88, Math.max(h * 0.6, 2 / zoom), 8);
    ctx.fill();
    ctx.restore();
  }
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
