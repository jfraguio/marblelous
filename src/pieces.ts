import type {
  Collider,
  MarbleType,
  MaterialId,
  Piece,
  PieceDef,
  Trigger,
  Vec2
} from './types';
import { clamp, polylinePoints, TAU } from './util';

export const COLORS = ['#3D7EA6', '#D95D39', '#E9B44C', '#4F9D69', '#7D5BA6', '#D26D8C'];

export const COLOR_NAMES = ['azul', 'rojo', 'amarillo', 'verde', 'morado', 'rosa'];

export const PALETTE = {
  paper: '#F2EFE7',
  paper2: '#E9E4D8',
  paper3: '#FFFDF8',
  ink: '#23211C',
  inkSoft: '#5F5A50',
  muted: '#9B9485',
  grid: '#DCD6C8',
  shadow: 'rgba(35,33,28,0.12)',
  blue: '#3D7EA6',
  red: '#D95D39',
  yellow: '#E9B44C',
  green: '#4F9D69',
  purple: '#7D5BA6',
  pink: '#D26D8C',
  teal: '#2E9E97',
  steel: '#8B97A3',
  wood: '#D9A066',
  woodDark: '#A96E3C',
  white: '#FFFDF8'
};

interface Mat {
  e: number;
  mu: number;
  roll: number;
  mat: MaterialId;
}

export const MATERIALS: Record<string, Mat> = {
  brick: { e: 0.35, mu: 0.45, roll: 0.8, mat: 'brick' },
  rubber: { e: 0.92, mu: 0.6, roll: 1.2, mat: 'rubber' },
  chime: { e: 0.35, mu: 0.3, roll: 0.5, mat: 'chime' },
  conveyor: { e: 0.1, mu: 0.9, roll: 1.4, mat: 'conveyor' },
  metal: { e: 0.55, mu: 0.15, roll: 0.3, mat: 'metal' }
};

export const MARBLE_TYPES: MarbleType[] = [
  {
    id: 'crystal',
    label: 'Canica de cristal',
    r: 22.95,
    density: 1,
    e: 0.45,
    mu: 0.18,
    roll: 0.8,
    color: '#8FD3EE'
  },
  {
    id: 'rubber',
    label: 'Canica de goma',
    r: 24.225,
    density: 0.85,
    e: 0.82,
    mu: 0.35,
    roll: 1.25,
    color: '#E8735A'
  },
  {
    id: 'steel',
    label: 'Canica de acero',
    r: 21.675,
    density: 2.6,
    e: 0.25,
    mu: 0.08,
    roll: 0.3,
    color: '#A8B3BD'
  },
  {
    id: 'comet',
    label: 'Canica cometa',
    r: 22.95,
    density: 1,
    e: 0.4,
    mu: 0.15,
    roll: 0.6,
    color: '#F2A33C',
    glow: '#F2A33C',
    premium: true
  },
  {
    id: 'plasma',
    label: 'Canica plasma',
    r: 22.95,
    density: 0.9,
    e: 0.5,
    mu: 0.12,
    roll: 0.5,
    color: '#B45AE8',
    glow: '#5AE8D8',
    premium: true
  },
  {
    id: 'rainbow',
    label: 'Canica arcoíris',
    r: 22.95,
    density: 1,
    e: 0.5,
    mu: 0.15,
    roll: 0.6,
    color: '#F4F0FF',
    glow: '#FF8FD3',
    premium: true
  },
  {
    id: 'surprise',
    label: 'Canica sorpresa',
    r: 22.95,
    density: 1,
    e: 0.5,
    mu: 0.2,
    roll: 0.7,
    color: '#F2EFE7'
  }
];

export const MARBLE_BY_ID = new Map(MARBLE_TYPES.map((m) => [m.id, m]));

const P = Math.PI;

function tx(p: Piece, lx: number, ly: number): Vec2 {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
}

function dir(p: Piece, lx: number, ly: number): Vec2 {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}

interface ColOpts {
  note?: number;
  pitch?: number;
  chime?: boolean;
  conveyor?: number;
  cannon?: boolean;
  bumper?: boolean;
  bubble?: boolean;
  tangent?: Vec2;
  up?: Vec2;
  e?: number;
}

function addCap(
  out: Collider[],
  p: Piece,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  matName: keyof typeof MATERIALS,
  opts: ColOpts = {}
) {
  const a = tx(p, ax, ay);
  const b = tx(p, bx, by);
  const m = MATERIALS[matName];
  out.push({
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
    r,
    e: opts.e ?? m.e,
    mu: m.mu,
    roll: m.roll,
    mat: m.mat,
    pieceId: p.id,
    note: opts.note ?? -1,
    pitch: opts.pitch,
    conveyor: opts.conveyor ?? 0,
    cannon: opts.cannon ? 1 : 0,
    bumper: opts.bumper ? 1 : 0,
    bubble: opts.bubble ? 1 : 0,
    chime: opts.chime ? 1 : 0,
    tx: opts.tangent ? dir(p, opts.tangent.x, opts.tangent.y).x : 0,
    ty: opts.tangent ? dir(p, opts.tangent.x, opts.tangent.y).y : 0,
    ux: opts.up ? dir(p, opts.up.x, opts.up.y).x : 0,
    uy: opts.up ? dir(p, opts.up.x, opts.up.y).y : 0
  });
}

function rectColliders(
  out: Collider[],
  p: Piece,
  w: number,
  h: number,
  r: number,
  mat: keyof typeof MATERIALS,
  oy = 0
) {
  const hw = Math.max(1, w / 2 - r);
  const hh = Math.max(1, h / 2 - r);
  addCap(out, p, -hw, oy - hh, hw, oy - hh, r, mat);
  addCap(out, p, hw, oy - hh, hw, oy + hh, r, mat);
  addCap(out, p, hw, oy + hh, -hw, oy + hh, r, mat);
  addCap(out, p, -hw, oy + hh, -hw, oy - hh, r, mat);
}

function arcColliders(
  out: Collider[],
  p: Piece,
  radius: number,
  start: number,
  end: number,
  count: number,
  r: number,
  mat: keyof typeof MATERIALS,
  opts: ColOpts = {}
) {
  let prevX = Math.cos(start) * radius;
  let prevY = Math.sin(start) * radius;
  for (let i = 1; i <= count; i++) {
    const a = start + ((end - start) * i) / count;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    addCap(out, p, prevX, prevY, x, y, r, mat, opts);
    prevX = x;
    prevY = y;
  }
}

/**
 * Suela de las máquinas magnéticas: dos rampas cortas para que la canica suba
 * desde la pista y una plataforma superior plana.
 */
function addBaseMount(out: Collider[], p: Piece) {
  const m = pieceBaseMount(p.defId);
  if (!m) return;
  const r = 2;
  // La cuña de subida se prolonga por debajo de la pista: así el extremo
  // inferior no forma un escalón que frene a la canica. Además se comporta
  // como una pequeña cinta magnética que ayuda a subirla hasta la base.
  const drop = 8;
  const run = m.lip + 50;
  const lowY = m.bottom + drop;
  const len = Math.hypot(run, lowY - m.top) || 1;
  const leftTangent = { x: run / len, y: (m.top - lowY) / len };
  const rightTangent = { x: -run / len, y: (m.top - lowY) / len };
  addCap(out, p, -m.halfWidth - run, lowY, -m.halfWidth, m.top, r, 'metal', {
    conveyor: 340,
    tangent: leftTangent
  });
  addCap(out, p, m.halfWidth, m.top, m.halfWidth + run, lowY, r, 'metal', {
    conveyor: 340,
    tangent: rightTangent
  });
  addCap(out, p, -m.halfWidth, m.top, m.halfWidth, m.top, r, 'metal');
}

export const RAMP_CURVE_RADIUS = 100;
export const RAMP_CURVE_START = P;
export const RAMP_CURVE_END = 1.5 * P;

/** Pista descendente con tangentes horizontales en ambos extremos. */
export const S_TRACK = Array.from({ length: 17 }, (_, i) => {
  const t = i / 16;
  return { x: -120 + 240 * t, y: -40 * Math.cos(Math.PI * t) };
});

export const FAN_HALF = 52;
export const FAN_INTAKE_TOP = 54;
export const FAN_INTAKE_BOTTOM = 116;
export const FAN_OUTLET = -108;
export const CHANNEL_ENTRY = -79;
export const CHANNEL_EXIT = 77;
export const SPLITTER_EXIT_X = 82;
export const METER_INTERVALS = [0.45, 0.8, 1.25];
export const XYLO_NOTES = [0, 1, 2, 3, 4];

export function xyloNotes(notes?: number[]): number[] {
  return XYLO_NOTES.map((fallback, i) => {
    const note = notes?.[i];
    return Number.isInteger(note) && note! >= 0 && note! < XYLO_NOTES.length ? note! : fallback;
  });
}

function buildChannel(p: Piece, kind: 'splitter' | 'meter') {
  return {
    colliders: [],
    triggers: [{ kind, x: p.x, y: p.y, w: 86, h: 222, rot: p.rot, r: 0,
      power: kind === 'meter' ? METER_INTERVALS[p.variant] ?? METER_INTERVALS[1] : 0,
      pieceId: p.id, disabledUntil: 0, dx: 0, dy: 0, pairId: 0 }]
  };
}

export function xyloLayout(count: number): { widths: number[]; xs: number[]; total: number } {
  const widths: number[] = [];
  for (let i = 0; i < count; i++) widths.push(88 - i * 4);
  const gap = 9;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (count - 1);
  const xs: number[] = [];
  let x = -total / 2;
  for (const w of widths) {
    xs.push(x + w / 2);
    x += w + gap;
  }
  return { widths, xs, total };
}

export const FUNNEL_LEFT: Vec2[] = [
  { x: -94, y: -80 },
  { x: -88, y: -52 },
  { x: -76, y: -20 },
  { x: -60, y: 14 },
  { x: -46, y: 42 },
  { x: -41, y: 64 },
  { x: -40, y: 84 }
];

/** Anchura total de la boca del embudo sin extender. */
export const FUNNEL_TOP_WIDTH = 188;
/** Anchuras disponibles al pulsar «extender» en el embudo. */
export const FUNNEL_WIDTHS = [FUNNEL_TOP_WIDTH, 260, 340, 440, 560];
const FUNNEL_NECK_Y = 42;

function funnelWidthAtPoint(index: number, len: number): number {
  const pt = FUNNEL_LEFT[index];
  const spread = clamp((FUNNEL_NECK_Y - pt.y) / (FUNNEL_NECK_Y - FUNNEL_LEFT[0].y), 0, 1);
  return -pt.x * (1 + (Math.max(1, len / FUNNEL_TOP_WIDTH) - 1) * spread);
}

export function funnelHalfWidthAt(len: number, y: number): number {
  for (let i = 1; i < FUNNEL_LEFT.length; i++) {
    const b = FUNNEL_LEFT[i];
    if (y > b.y) continue;
    const a = FUNNEL_LEFT[i - 1];
    const t = Math.max(0, (y - a.y) / (b.y - a.y));
    return funnelWidthAtPoint(i - 1, len) * (1 - t) + funnelWidthAtPoint(i, len) * t;
  }
  return -FUNNEL_LEFT[FUNNEL_LEFT.length - 1].x;
}

/**
 * Geometría del embudo. Al extenderlo solo se abre la parte alta: el cuello y
 * la salida inferior conservan su tamaño original.
 */
export function funnelLayout(p?: { len: number }): { left: Vec2[]; right: Vec2[] } {
  const len = p?.len || FUNNEL_TOP_WIDTH;
  const left = FUNNEL_LEFT.map((pt, i) => ({ x: -funnelWidthAtPoint(i, len), y: pt.y }));
  return { left, right: left.map((pt) => ({ x: -pt.x, y: pt.y })) };
}

/**
 * Base magnética de las máquinas que se apoyan sobre una rampa. `bottom` es la
 * altura local de la suela y `lip` el largo de las rampas de subida laterales.
 */
export interface PieceBaseMount {
  halfWidth: number;
  bottom: number;
  top: number;
  lip: number;
}

const BASE_MOUNTS: Record<string, PieceBaseMount> = {
  bubbleLift: { halfWidth: 38, bottom: 68, top: 54, lip: 34 },
  fan: { halfWidth: FAN_HALF, bottom: 108, top: 88, lip: 0 },
  cannon: { halfWidth: 40, bottom: 22, top: 6, lip: 40 },
  hourglass: { halfWidth: 34, bottom: 62, top: 50, lip: 30 }
};

export function pieceBaseMount(defId: string): PieceBaseMount | null {
  return BASE_MOUNTS[defId] ?? null;
}

/** Longitud efectiva de una pieza extensible (con compatibilidad para saves). */
export function pieceLength(p: Piece): number {
  return p.len > 0 ? p.len : defaultLen(p.defId);
}

export const SPIRAL_TURNS = 2.25;
export const SPIRAL_DURATION = 2.4;

export function spiralAngle(t: number): number {
  return -Math.PI / 2 + t * TAU * SPIRAL_TURNS;
}

/** Proyección 2.5D local de la hélice: x lateral, y descendente. */
export function spiralLocal(t: number): Vec2 {
  const a = spiralAngle(t);
  const rx = 122 - 64 * t;
  const ry = rx * 0.36;
  const cy = -78 + 232 * t;
  return { x: Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
}

export function spiralDepth(t: number): number {
  return Math.sin(spiralAngle(t));
}

export const SPIRAL_ENTRY = spiralLocal(0);

/** Punto local de salida de la Fábrica de canicas (por debajo de la boca). */
export const FACTORY_OUTLET = { x: 0, y: 72 };
/** Posición local de la lucecita de estado de la Fábrica de canicas. */
export const FACTORY_LAMP = { x: 30, y: -6 };

const defs: PieceDef[] = [
  {
    id: 'ramp',
    label: 'Rampa',
    w: 320,
    h: 20,
    tintable: true,
    defaultColor: 1,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, -p.len / 2, 0, p.len / 2, 0, 8, 'brick');
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'rampCurve',
    label: 'Rampa curva',
    w: 200,
    h: 200,
    tintable: true,
    defaultColor: 2,
    build: (p) => {
      const c: Collider[] = [];
      arcColliders(c, p, RAMP_CURVE_RADIUS, RAMP_CURVE_START, RAMP_CURVE_END, 24, 6, 'brick');
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'sTrack',
    label: 'Canal en S',
    w: 260,
    h: 108,
    tintable: true,
    defaultColor: 3,
    build: (p) => {
      const colliders: Collider[] = [];
      for (let i = 1; i < S_TRACK.length; i++) {
        const a = S_TRACK[i - 1];
        const b = S_TRACK[i];
        addCap(colliders, p, a.x, a.y, b.x, b.y, 8, 'brick', { e: 0.18 });
      }
      return { colliders, triggers: [] };
    }
  },
  {
    id: 'balance',
    label: 'Balancín',
    w: 280,
    h: 64,
    tintable: true,
    defaultColor: 2,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, -122, 0, 122, 0, 8, 'brick');
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'funnel',
    label: 'Embudo',
    w: 210,
    h: 180,
    tintable: true,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const { left, right } = funnelLayout(p);
      const addCurve = (pts: Vec2[]) => {
        for (let i = 0; i < pts.length - 1; i++) {
          addCap(c, p, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, 6, 'brick', { e: 0.14 });
        }
      };
      addCurve(left);
      addCurve(right);
      return {
        colliders: c,
        triggers: [
          { kind: 'funnel', x: p.x, y: p.y, w: pieceLength(p), h: 224, r: 0, rot: p.rot, power: 0, pieceId: p.id, disabledUntil: 0, dx: 0, dy: 0, pairId: 0 }
        ]
      };
    }
  },
  {
    id: 'conveyor',
    label: 'Cinta transportadora',
    w: 360,
    h: 24,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const half = pieceLength(p) / 2;
      addCap(c, p, -half, 0, half, 0, 8, 'conveyor', {
        conveyor: 220,
        tangent: { x: 1, y: 0 }
      });
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'bumper',
    label: 'Parachoques',
    w: 60,
    h: 60,
    tintable: false,
    defaultColor: 1,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, 0, 0, 0, 0, 28, 'rubber', { bumper: true, e: 0.92 });
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'booster',
    label: 'Propulsor',
    w: 80,
    h: 80,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const d = dir(p, 1, 0);
      return {
        colliders: [],
        triggers: [
          {
            kind: 'boost',
            x: p.x,
            y: p.y,
            w: 80,
            h: 80,
            r: 0,
            rot: p.rot,
            power: 6000,
            pieceId: p.id,
            disabledUntil: 0,
            dx: d.x,
            dy: d.y,
            pairId: 0
          }
        ]
      };
    }
  },
  {
    id: 'cannon',
    label: 'Cañón',
    w: 100,
    h: 60,
    tintable: false,
    defaultColor: 4,
    build: (p) => {
      const c: Collider[] = [];
      addBaseMount(c, p);
      const up = dir(p, 0, -1);
      const m = pieceBaseMount(p.defId)!;
      const trigger = tx(p, 0, m.top - 20);
      return {
        colliders: c,
        triggers: [
          {
            kind: 'cannon',
            x: trigger.x,
            y: trigger.y,
            w: m.halfWidth * 1.7,
            h: 28,
            r: 0,
            rot: p.rot,
            power: 1800,
            pieceId: p.id,
            disabledUntil: 0,
            dx: up.x,
            dy: up.y,
            pairId: 0
          }
        ]
      };
    }
  },
  {
    id: 'star',
    label: 'Estrella',
    w: 48,
    h: 48,
    tintable: false,
    defaultColor: 2,
    build: (p) => ({
      colliders: [],
      triggers: [
        {
          kind: 'star',
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          r: 19,
          rot: 0,
          power: 0,
          pieceId: p.id,
          disabledUntil: 0,
          dx: 0,
          dy: 0,
          pairId: 0
        }
      ]
    })
  },
  {
    id: 'goal',
    label: 'Campana',
    w: 120,
    h: 120,
    tintable: false,
    defaultColor: 2,
    build: (p) => ({
      colliders: [],
      triggers: [
        {
          kind: 'goal',
          x: p.x,
          y: p.y + 8,
          w: 100,
          h: 96,
          r: 0,
          rot: p.rot,
          power: 0,
          pieceId: p.id,
          disabledUntil: 0,
          dx: 0,
          dy: 0,
          pairId: 0
        }
      ]
    })
  },
  {
    id: 'spiral',
    label: 'Caída en espiral',
    w: 280,
    h: 320,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const e = tx(p, SPIRAL_ENTRY.x, SPIRAL_ENTRY.y);
      return {
        colliders: [],
        triggers: [
          {
            kind: 'spiral',
            x: e.x,
            y: e.y,
            w: 0,
            h: 0,
            r: 68,
            rot: p.rot,
            power: 0,
            pieceId: p.id,
            disabledUntil: 0,
            dx: 0,
            dy: 0,
            pairId: 0
          }
        ]
      };
    }
  },
  {
    id: 'bubble',
    label: 'Rampa-burbuja',
    w: 240,
    h: 26,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const half = pieceLength(p) / 2;
      addCap(c, p, -half, 0, half, 0, 5, 'brick', { bubble: true, e: 0.02 });
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'bubbleLift',
    label: 'Fábrica de burbujas',
    w: 140,
    h: 160,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      addBaseMount(c, p);
      const center = tx(p, 0, 0);
      return {
        colliders: c,
        triggers: [
          {
            kind: 'bubbleLift',
            x: center.x,
            y: center.y,
            w: 0,
            h: 0,
            r: 46,
            rot: p.rot,
            power: 0,
            pieceId: p.id,
            disabledUntil: 0,
            dx: 0,
            dy: 0,
            pairId: 0
          }
        ]
      };
    }
  },
  {
    id: 'marbleFactory',
    label: 'Fábrica de canicas',
    w: 140,
    h: 170,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      // Cuerpo metálico de la máquina. La tolva superior es decorativa.
      rectColliders(c, p, 88, 64, 10, 'metal', 12);
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'portal',
    label: 'Portales',
    w: 240,
    h: 100,
    tintable: false,
    defaultColor: 4,
    build: (p) => {
      const half = p.len > 0 ? p.len / 2 : 62;
      const a = tx(p, -half, 0);
      const b = tx(p, half, 0);
      return {
        colliders: [],
        triggers: [
          { kind: 'portal', x: a.x, y: a.y, w: 0, h: 0, r: 28, rot: p.rot, power: 0, pieceId: p.id, disabledUntil: 0, dx: 0, dy: 0, pairId: p.id },
          { kind: 'portal', x: b.x, y: b.y, w: 0, h: 0, r: 28, rot: p.rot, power: 0, pieceId: p.id, disabledUntil: 0, dx: 0, dy: 0, pairId: p.id }
        ]
      };
    }
  },
  {
    id: 'fan',
    label: 'Ventilador',
    w: 110,
    h: 220,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const up = dir(p, 0, -1);
      return {
        colliders: [],
        triggers: [
          { kind: 'fan', x: p.x, y: p.y, w: FAN_HALF * 2, h: 232, r: 0, rot: p.rot, power: 3400, pieceId: p.id, disabledUntil: 0, dx: up.x, dy: up.y, pairId: 0 }
        ]
      };
    }
  },
  {
    id: 'electromagnet',
    label: 'Electroimán',
    w: 96,
    h: 96,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, 0, 0, 0, 0, 26, 'metal', { e: 0.18 });
      const power = (p.polarity ?? 1) < 0 ? -6800 : 6800;
      return {
        colliders: c,
        triggers: [
          { kind: 'magnet', x: p.x, y: p.y, w: 0, h: 0, r: 170, rot: p.rot, power, pieceId: p.id, disabledUntil: 0, dx: 0, dy: 0, pairId: 0 }
        ]
      };
    }
  },
  {
    id: 'hourglass',
    label: 'Reloj de arena',
    w: 96,
    h: 132,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      addBaseMount(c, p);
      return {
        colliders: c,
        triggers: [
          { kind: 'hourglass', x: p.x, y: p.y, w: 0, h: 0, r: 54, rot: p.rot, power: 0, pieceId: p.id, disabledUntil: 0, dx: 0, dy: 0, pairId: 0 }
        ]
      };
    }
  },
  {
    id: 'splitter', label: 'Bifurcación', w: 240, h: 186, tintable: false, defaultColor: 3,
    build: (p) => buildChannel(p, 'splitter')
  },
  {
    id: 'meter', label: 'Dosificador', w: 124, h: 186, tintable: false, defaultColor: 4,
    build: (p) => buildChannel(p, 'meter')
  },
  {
    id: 'xylo5',
    label: 'Xilófono de 5 notas',
    w: 440,
    h: 64,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const layout = xyloLayout(5);
      const notes = xyloNotes(p.notes);
      for (let i = 0; i < layout.widths.length; i++) {
        const w = layout.widths[i];
        addCap(c, p, layout.xs[i] - w / 2 + 1, -4, layout.xs[i] + w / 2 - 1, -4, 7, 'chime', {
          note: i,
          pitch: notes[i],
          chime: true
        });
      }
      return { colliders: c, triggers: [] };
    }
  }
];

export const PIECE_BY_ID = new Map(defs.map((d) => [d.id, d]));

export function getPieceDef(id: string): PieceDef {
  return PIECE_BY_ID.get(id) ?? defs[0];
}

export function defaultLen(defId: string): number {
  if (defId === 'ramp') return 320;
  if (defId === 'conveyor') return 320;
  if (defId === 'bubble') return 220;
  if (defId === 'funnel') return FUNNEL_TOP_WIDTH;
  if (defId === 'portal') return 124;
  return 0;
}

export function makePiece(id: number, defId: string, x: number, y: number, rot = 0, len?: number): Piece {
  const def = getPieceDef(defId);
  return {
    id,
    defId,
    x,
    y,
    rot,
    len: len ?? defaultLen(defId),
    color: def.defaultColor,
    variant: defId === 'meter' ? 1 : 0,
    powered: defId === 'marbleFactory' ? true : undefined,
    bornAt: performance.now()
  };
}

export function buildPiece(p: Piece): { colliders: Collider[]; triggers: Trigger[] } {
  return getPieceDef(p.defId).build(p);
}

export function pieceHitSize(p: Piece): { w: number; h: number } {
  const d = getPieceDef(p.defId);
  if (p.defId === 'ramp') return { w: p.len + 16, h: 28 };
  if (p.defId === 'conveyor') return { w: pieceLength(p) + 16, h: 30 };
  if (p.defId === 'bubble') return { w: pieceLength(p) + 20, h: 28 };
  if (p.defId === 'funnel') return { w: Math.max(d.w, pieceLength(p) + 20), h: d.h };
  if (p.defId === 'portal') return { w: p.len + 84, h: 120 };
  return { w: d.w, h: d.h };
}

export interface PiecePort {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** Puntos de conexión magnética en coordenadas locales. */
export function piecePorts(p: Piece): PiecePort[] {
  const out: PiecePort[] = [];
  const add = (x: number, y: number, dx: number, dy: number) => out.push({ x, y, dx, dy });
  if (p.defId === 'ramp') {
    add(-p.len / 2, 0, -1, 0);
    add(p.len / 2, 0, 1, 0);
  } else if (p.defId === 'bubble') {
    const half = pieceLength(p) / 2;
    add(-half, 0, -1, 0);
    add(half, 0, 1, 0);
  } else if (p.defId === 'conveyor') {
    const half = pieceLength(p) / 2;
    add(-half, 0, -1, 0);
    add(half, 0, 1, 0);
  } else if (p.defId === 'rampCurve') {
    const r = RAMP_CURVE_RADIUS;
    const a = { x: Math.cos(RAMP_CURVE_START) * r, y: Math.sin(RAMP_CURVE_START) * r };
    const b = { x: Math.cos(RAMP_CURVE_END) * r, y: Math.sin(RAMP_CURVE_END) * r };
    const ta = { x: -Math.sin(RAMP_CURVE_START), y: Math.cos(RAMP_CURVE_START) };
    const tb = { x: -Math.sin(RAMP_CURVE_END), y: Math.cos(RAMP_CURVE_END) };
    add(a.x, a.y, -ta.x, -ta.y);
    add(b.x, b.y, tb.x, tb.y);
  } else if (p.defId === 'sTrack') {
    const a = S_TRACK[0];
    const b = S_TRACK[S_TRACK.length - 1];
    add(a.x, a.y, -1, 0);
    add(b.x, b.y, 1, 0);
  } else if (p.defId === 'bubbleLift') {
    add(-48, 0, -1, 0);
    add(48, 0, 1, 0);
  } else if (p.defId === 'booster') {
    add(0, 40, 0, 1);
    add(-40, 40, -1, 0);
    add(40, 40, 1, 0);
  } else if (p.defId === 'fan') {
    add(0, 106, 0, 1);
    add(-52, 106, -1, 0);
    add(52, 106, 1, 0);
  } else if (p.defId === 'splitter' || p.defId === 'meter') {
    add(0, CHANNEL_ENTRY, 0, -1);
    if (p.defId === 'meter') add(0, CHANNEL_EXIT, 0, 1);
    else {
      add(-SPLITTER_EXIT_X, CHANNEL_EXIT, -0.5, 0.866);
      add(SPLITTER_EXIT_X, CHANNEL_EXIT, 0.5, 0.866);
    }
  } else if (p.defId === 'spiral') {
    const a = spiralLocal(0);
    const b = spiralLocal(1);
    const a2 = spiralLocal(0.01);
    const b2 = spiralLocal(0.99);
    const ta = { x: a2.x - a.x, y: a2.y - a.y };
    const tb = { x: b.x - b2.x, y: b.y - b2.y };
    const la = Math.hypot(ta.x, ta.y) || 1;
    const lb = Math.hypot(tb.x, tb.y) || 1;
    add(a.x, a.y, -ta.x / la, -ta.y / la);
    add(b.x, b.y, tb.x / lb, tb.y / lb);
  } else if (p.defId === 'funnel') {
    const half = pieceLength(p) / 2;
    const y = FUNNEL_LEFT[0].y;
    add(-half, y, 0, -1);
    add(half, y, 0, -1);
    add(-half * 0.66, y - 10, -1, 0);
    add(half * 0.66, y - 10, 1, 0);
  }
  return out;
}

export function pieceContains(p: Piece, wx: number, wy: number): boolean {
  const dx = wx - p.x;
  const dy = wy - p.y;
  const c = Math.cos(-p.rot);
  const s = Math.sin(-p.rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const { w, h } = pieceHitSize(p);
  // Las barras largas y finas son difíciles de agarrar con el dedo: se les da
  // un margen de toque extra sin agrandar el rectángulo de selección visible.
  const bar = p.defId === 'ramp' || p.defId === 'conveyor';
  const padX = bar ? 6 : 0;
  const padY = bar ? 10 : p.defId === 'bubble' ? 6 : 0;
  return Math.abs(lx) <= w / 2 + padX && Math.abs(ly) <= h / 2 + padY;
}

export function pieceCorners(p: Piece): Vec2[] {
  const { w, h } = pieceHitSize(p);
  return [
    tx(p, -w / 2, -h / 2),
    tx(p, w / 2, -h / 2),
    tx(p, w / 2, h / 2),
    tx(p, -w / 2, h / 2)
  ];
}

export const PIECE_TRAY = [
  'ramp', 'rampCurve', 'sTrack', 'splitter', 'meter', 'balance', 'funnel', 'conveyor', 'spiral', 'bubble',
  'bubbleLift', 'marbleFactory', 'portal', 'fan', 'electromagnet', 'hourglass', 'xylo5',
  'booster', 'cannon', 'bumper', 'star', 'goal'
].map(getPieceDef);

export function noteFrequency(note: number): number {
  return [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25][note] ?? 261.63;
}

export const NOTE_COLORS = [
  '#E9B44C',
  '#E6A447',
  '#E49045',
  '#E07C4A',
  '#D96A50',
  '#D95D58',
  '#D26D7E',
  '#C978A4'
];

export function noteLabel(note: number): string {
  return ['Do', 'Re', 'Mi', 'Sol', 'La', 'Do', 'Re', 'Mi'][note] ?? 'Do';
}

export function mineMarble(id: string): MarbleType {
  return MARBLE_BY_ID.get(id) ?? MARBLE_TYPES[0];
}

export { TAU };
