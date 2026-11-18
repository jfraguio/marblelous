import type { Vec2 } from './types';

export const TAU = Math.PI * 2;

/**
 * Cámara 3/4: el plano del mundo se comprime ligeramente en vertical. Es solo
 * una transformación visual; `Game.screenToWorld` la invierte para que tocar
 * siga siendo exacto.
 */
export const CAMERA_TILT = 0.93;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

export function normAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function rotatePoint(x: number, y: number, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('es-ES');
}

export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (v: number) => {
    const n = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  };
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function hash2(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export function shortAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

let audioUnlocked = false;
export function markAudioUnlocked() {
  audioUnlocked = true;
}
export function isAudioUnlocked() {
  return audioUnlocked;
}

export function vibrate(ms: number) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* noop */
  }
}

export function icon(name: string, cls = 'ic'): string {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function polylinePoints(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  n: number
): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * ax + 2 * u * t * cx + t * t * bx,
      y: u * u * ay + 2 * u * t * cy + t * t * by
    });
  }
  return out;
}

export function nowMs(): number {
  return performance.now();
}
