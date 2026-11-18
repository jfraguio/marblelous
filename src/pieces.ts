import type {
  Collider,
  MarbleType,
  MaterialId,
  Piece,
  PieceDef,
  ShopItem,
  Trigger,
  Vec2
} from './types';
import { polylinePoints, TAU } from './util';

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
    price: 0,
    r: 22.95,
    density: 1,
    e: 0.45,
    mu: 0.18,
    roll: 0.8,
    bonus: 1,
    color: '#8FD3EE'
  },
  {
    id: 'rubber',
    label: 'Canica de goma',
    price: 250,
    r: 24.225,
    density: 0.85,
    e: 0.82,
    mu: 0.35,
    roll: 1.25,
    bonus: 1,
    color: '#E8735A'
  },
  {
    id: 'steel',
    label: 'Canica de acero',
    price: 600,
    r: 21.675,
    density: 2.6,
    e: 0.25,
    mu: 0.08,
    roll: 0.3,
    bonus: 1.05,
    color: '#A8B3BD'
  },
  {
    id: 'comet',
    label: 'Canica cometa',
    price: 1500,
    r: 22.95,
    density: 1,
    e: 0.4,
    mu: 0.15,
    roll: 0.6,
    bonus: 1.15,
    color: '#F2A33C',
    glow: '#F2A33C',
    premium: true
  },
  {
    id: 'plasma',
    label: 'Canica plasma',
    price: 2500,
    r: 22.95,
    density: 0.9,
    e: 0.5,
    mu: 0.12,
    roll: 0.5,
    bonus: 1.3,
    color: '#B45AE8',
    glow: '#5AE8D8',
    premium: true
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
  mat: keyof typeof MATERIALS
) {
  const hw = Math.max(1, w / 2 - r);
  const hh = Math.max(1, h / 2 - r);
  addCap(out, p, -hw, -hh, hw, -hh, r, mat);
  addCap(out, p, hw, -hh, hw, hh, r, mat);
  addCap(out, p, hw, hh, -hw, hh, r, mat);
  addCap(out, p, -hw, hh, -hw, -hh, r, mat);
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

export const RAMP_CURVE_RADIUS = 100;
export const RAMP_CURVE_START = P;
export const RAMP_CURVE_END = 1.5 * P;

export const HALF_PIPE_RADIUS = 90;

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

export const FUNNEL_LEFT = polylinePoints(-88, -72, -76, 18, -32, 56, 12);
export const FUNNEL_RIGHT = polylinePoints(88, -72, 76, 18, 32, 56, 12);

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

const defs: PieceDef[] = [
  {
    id: 'ramp',
    category: 'build',
    price: 0,
    label: 'Rampa',
    w: 320,
    h: 20,
    tintable: true,
    defaultColor: 1,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, -p.len / 2, 0, p.len / 2, 0, 6, 'brick');
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'rampCurve',
    category: 'build',
    price: 250,
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
    id: 'trampoline',
    category: 'build',
    price: 300,
    label: 'Trampolín',
    w: 240,
    h: 24,
    tintable: false,
    defaultColor: 3,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, -104, 0, 104, 0, 6, 'rubber');
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'halfPipe',
    category: 'build',
    price: 800,
    label: 'Medio tubo',
    w: 200,
    h: 200,
    tintable: true,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      arcColliders(c, p, HALF_PIPE_RADIUS, 0, P, 36, 6, 'brick');
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'funnel',
    category: 'build',
    price: 550,
    label: 'Embudo',
    w: 200,
    h: 160,
    tintable: true,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const addCurve = (pts: Vec2[]) => {
        for (let i = 0; i < pts.length - 1; i++) {
          addCap(c, p, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, 6, 'brick');
        }
      };
      addCurve(FUNNEL_LEFT);
      addCurve(FUNNEL_RIGHT);
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'conveyor',
    category: 'build',
    price: 850,
    label: 'Cinta transportadora',
    w: 360,
    h: 24,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, -144, 0, 144, 0, 6, 'conveyor', {
        conveyor: 220,
        tangent: { x: 1, y: 0 }
      });
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'bumper',
    category: 'energy',
    price: 800,
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
    id: 'spike',
    category: 'energy',
    price: 0,
    label: 'Pincho',
    w: 70,
    h: 100,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const tip = tx(p, 0, 34);
      return {
        colliders: [],
        triggers: [
          {
            kind: 'spike',
            x: tip.x,
            y: tip.y,
            w: 0,
            h: 0,
            r: 26,
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
    id: 'booster',
    category: 'energy',
    price: 600,
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
    category: 'energy',
    price: 900,
    label: 'Cañón',
    w: 100,
    h: 60,
    tintable: false,
    defaultColor: 4,
    build: (p) => {
      const c: Collider[] = [];
      rectColliders(c, p, 80, 20, 4, 'metal');
      for (const col of c) {
        col.cannon = 1;
        const up = dir(p, 0, -1);
        col.ux = up.x;
        col.uy = up.y;
      }
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'star',
    category: 'energy',
    price: 350,
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
    category: 'energy',
    price: 0,
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
    id: 'magnet',
    category: 'energy',
    price: 1400,
    label: 'Imán',
    w: 360,
    h: 360,
    tintable: false,
    defaultColor: 1,
    build: (p) => ({
      colliders: [],
      triggers: [
        {
          kind: 'magnet',
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          r: 180,
          rot: 0,
          power: 1000,
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
    category: 'build',
    price: 0,
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
    category: 'energy',
    price: 0,
    label: 'Burbuja',
    w: 220,
    h: 30,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      addCap(c, p, -92, 0, 92, 0, 8, 'rubber', { bubble: true, e: 0.15 });
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'bubbleLift',
    category: 'energy',
    price: 0,
    label: 'Burbuja ascensora',
    w: 130,
    h: 150,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const center = tx(p, 0, -10);
      return {
        colliders: [],
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
    id: 'portal',
    category: 'energy',
    price: 0,
    label: 'Portales',
    w: 240,
    h: 100,
    tintable: false,
    defaultColor: 4,
    build: (p) => {
      const a = tx(p, -62, 0);
      const b = tx(p, 62, 0);
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
    category: 'energy',
    price: 0,
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
          { kind: 'fan', x: p.x, y: p.y, w: 96, h: 200, r: 0, rot: p.rot, power: 3400, pieceId: p.id, disabledUntil: 0, dx: up.x, dy: up.y, pairId: 0 }
        ]
      };
    }
  },
  {
    id: 'mill',
    category: 'energy',
    price: 0,
    label: 'Molino',
    w: 150,
    h: 150,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const side = dir(p, 1, 0);
      return {
        colliders: [],
        triggers: [
          {
            kind: 'mill',
            x: p.x,
            y: p.y,
            w: 240,
            h: 150,
            r: 0,
            rot: p.rot,
            power: 900,
            pieceId: p.id,
            disabledUntil: 0,
            dx: side.x,
            dy: side.y,
            pairId: 0
          }
        ]
      };
    }
  },
  {
    id: 'xylo5',
    category: 'music',
    price: 650,
    label: 'Xilófono de 5 notas',
    w: 440,
    h: 64,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const layout = xyloLayout(5);
      for (let i = 0; i < layout.widths.length; i++) {
        const w = layout.widths[i];
        addCap(c, p, layout.xs[i] - w / 2 + 1, -4, layout.xs[i] + w / 2 - 1, -4, 7, 'chime', {
          note: i,
          chime: true
        });
      }
      return { colliders: c, triggers: [] };
    }
  },
  {
    id: 'xylo8',
    category: 'music',
    price: 1100,
    label: 'Xilófono de 8 notas',
    w: 700,
    h: 64,
    tintable: false,
    defaultColor: 0,
    build: (p) => {
      const c: Collider[] = [];
      const layout = xyloLayout(8);
      for (let i = 0; i < layout.widths.length; i++) {
        const w = layout.widths[i];
        addCap(c, p, layout.xs[i] - w / 2 + 1, -4, layout.xs[i] + w / 2 - 1, -4, 7, 'chime', {
          note: i,
          chime: true
        });
      }
      return { colliders: c, triggers: [] };
    }
  }
];

export const PIECES: PieceDef[] = defs;
export const PIECE_BY_ID = new Map(defs.map((d) => [d.id, d]));

export function getPieceDef(id: string): PieceDef {
  return PIECE_BY_ID.get(id) ?? defs[0];
}

export function makePiece(id: number, defId: string, x: number, y: number, rot = 0, len?: number): Piece {
  const def = getPieceDef(defId);
  return {
    id,
    defId,
    x,
    y,
    rot,
    len: len ?? (defId === 'ramp' ? 320 : 0),
    color: def.defaultColor,
    variant: 0,
    bornAt: performance.now()
  };
}

export function buildPiece(p: Piece): { colliders: Collider[]; triggers: Trigger[] } {
  return getPieceDef(p.defId).build(p);
}

export function pieceHitSize(p: Piece): { w: number; h: number } {
  const d = getPieceDef(p.defId);
  if (p.defId === 'ramp') return { w: p.len + 16, h: 28 };
  if (p.defId === 'magnet') return { w: 120, h: 120 };
  return { w: d.w, h: d.h };
}

export function pieceContains(p: Piece, wx: number, wy: number): boolean {
  const dx = wx - p.x;
  const dy = wy - p.y;
  const c = Math.cos(-p.rot);
  const s = Math.sin(-p.rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const { w, h } = pieceHitSize(p);
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
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

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'ramp', category: 'build', price: 0, label: 'Rampa', kind: 'piece' },
  { id: 'rampCurve', category: 'build', price: 250, label: 'Rampa curva', kind: 'piece' },
  { id: 'trampoline', category: 'build', price: 300, label: 'Trampolín', kind: 'piece' },
  { id: 'halfPipe', category: 'build', price: 800, label: 'Medio tubo', kind: 'piece' },
  { id: 'funnel', category: 'build', price: 550, label: 'Embudo', kind: 'piece' },
  { id: 'conveyor', category: 'build', price: 850, label: 'Cinta', kind: 'piece' },
  { id: 'spiral', category: 'build', price: 0, label: 'Caída en espiral', kind: 'piece' },
  { id: 'bubble', category: 'energy', price: 0, label: 'Burbuja', kind: 'piece' },
  { id: 'bubbleLift', category: 'energy', price: 0, label: 'Burbuja ascensora', kind: 'piece' },
  { id: 'portal', category: 'energy', price: 0, label: 'Portales', kind: 'piece' },
  { id: 'fan', category: 'energy', price: 0, label: 'Ventilador', kind: 'piece' },
  { id: 'mill', category: 'energy', price: 0, label: 'Molino', kind: 'piece' },
  { id: 'xylo5', category: 'music', price: 650, label: 'Xilófono 5', kind: 'piece' },
  { id: 'xylo8', category: 'music', price: 1100, label: 'Xilófono 8', kind: 'piece' },
  { id: 'booster', category: 'energy', price: 600, label: 'Propulsor', kind: 'piece' },
  { id: 'cannon', category: 'energy', price: 900, label: 'Cañón', kind: 'piece' },
  { id: 'bumper', category: 'energy', price: 800, label: 'Parachoques', kind: 'piece' },
  { id: 'spike', category: 'energy', price: 0, label: 'Pincho', kind: 'piece' },
  { id: 'star', category: 'energy', price: 350, label: 'Estrella', kind: 'piece' },
  { id: 'goal', category: 'energy', price: 0, label: 'Campana', kind: 'piece' },
  { id: 'magnet', category: 'energy', price: 1400, label: 'Imán', kind: 'piece' },
  { id: 'crystal', category: 'marbles', price: 0, label: 'Canica de cristal', kind: 'marble' },
  { id: 'rubber', category: 'marbles', price: 250, label: 'Canica de goma', kind: 'marble' },
  { id: 'steel', category: 'marbles', price: 600, label: 'Canica de acero', kind: 'marble' },
  { id: 'comet', category: 'marbles', price: 1500, label: 'Canica cometa', kind: 'marble' },
  { id: 'plasma', category: 'marbles', price: 2500, label: 'Canica plasma', kind: 'marble' }
];

export const STARTING_OWNED = SHOP_ITEMS.map((i) => i.id);

export const SHOP_BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

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
