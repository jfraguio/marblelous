export interface Vec2 {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type Mode = 'build' | 'play';
export type PieceCategory = 'build' | 'music' | 'energy';
export type ShopCategory = PieceCategory | 'marbles';
export type MaterialId = 'brick' | 'rubber' | 'chime' | 'conveyor' | 'metal' | 'field';

export interface Piece {
  id: number;
  defId: string;
  x: number;
  y: number;
  rot: number;
  len: number;
  color: number;
  variant: number;
  /** runtime animation state */
  flash?: number;
  flashNote?: number;
  anim?: number;
  disabledUntil?: number;
  charge?: number;
  /** electromagnet polarity: 1 atrae, -1 repele */
  polarity?: number;
  /** marble factory on/off state */
  powered?: boolean;
  /** next automatic marble emission timestamp (runtime) */
  emitAt?: number;
  bornAt?: number;
}

export interface Collider {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  e: number;
  mu: number;
  roll: number;
  mat: MaterialId;
  pieceId: number;
  note: number;
  conveyor: number;
  cannon: number;
  bumper: number;
  bubble: number;
  chime: number;
  /** local tangent for conveyor, already in world space */
  tx: number;
  ty: number;
  /** local up direction for cannons, already in world space */
  ux: number;
  uy: number;
}

export type TriggerKind = 'goal' | 'star' | 'boost' | 'portal' | 'fan' | 'spiral' | 'bubbleLift' | 'magnet' | 'hourglass' | 'cannon';

export interface Trigger {
  kind: TriggerKind;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  rot: number;
  power: number;
  pieceId: number;
  disabledUntil: number;
  /** boost/fan direction in world space */
  dx: number;
  dy: number;
  pairId: number;
}

export interface MarbleType {
  id: string;
  label: string;
  price: number;
  r: number;
  density: number;
  e: number;
  mu: number;
  roll: number;
  color: string;
  glow?: string;
  premium?: boolean;
}

export interface Marble {
  id: number;
  typeId: string;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  invMass: number;
  e: number;
  mu: number;
  roll: number;
  spin: number;
  awake: boolean;
  sleepTimer: number;
  contact: number;
  airTime: number;
  bornAt: number;
  dropId: number;
  alive: boolean;
  trail: number[];
  trailAcc: number;
  lastCannon: number;
  lastCannonPiece: number;
  lastBoost: number;
  lastBoostPiece: number;
  lastPortalAt: number;
  lastPortalPiece: number;
  lastRainbowAt: number;
  ridePiece: number;
  rideT: number;
  rideNextChime: number;
  rideScale: number;
  rideDepth: number;
  bubbled: boolean;
  bubbleT: number;
  bubbleReadyAt: number;
  /** canica generada automáticamente por una fábrica */
  auto?: boolean;
}

export interface PieceDef {
  id: string;
  category: PieceCategory;
  price: number;
  label: string;
  w: number;
  h: number;
  tintable: boolean;
  defaultColor: number;
  hasVariants?: boolean;
  build: (p: Piece) => { colliders: Collider[]; triggers: Trigger[] };
  /** optional per-piece visual bounds override */
  spriteW?: number;
  spriteH?: number;
}

export interface PhysEvent {
  type:
    | 'chime'
    | 'bumper'
    | 'cannon'
    | 'goal'
    | 'star'
    | 'boost'
    | 'portal'
    | 'spiral'
    | 'bubble'
    | 'pop'
    | 'air'
    | 'marble'
    | 'rainbow'
    | 'hourglass';
  x: number;
  y: number;
  pieceId: number;
  note: number;
  impact: number;
  marbleId: number;
  speed: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: number;
  rot: number;
  vr: number;
  alpha: number;
}

export interface Records {
  combo: number;
  speed: number;
  airTime: number;
  marbles: number;
  bestDrop: number;
  goals: number;
}

export interface Settings {
  quality: 'auto' | 'high' | 'low';
  haptics: boolean;
}

export interface WorldData {
  pieces: Piece[];
  camera: Camera;
  records: Records;
}

export interface SaveData {
  v: number;
  updatedAt: number;
  currency: number;
  lifetime: number;
  owned: string[];
  activeWorld: number;
  worlds: WorldData[];
  settings: Settings;
  selectedMarble: string;
}

export interface ShopItem {
  id: string;
  category: ShopCategory;
  price: number;
  label: string;
  kind: 'piece' | 'marble';
}
