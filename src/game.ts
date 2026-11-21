import type {
  Camera,
  DropSummary,
  Marble,
  Mode,
  Particle,
  PhysEvent,
  Piece,
  Popup,
  Records,
  SaveData,
  Settings,
  WorldData
} from './types';
import { AudioEngine } from './audio';
import { PhysicsWorld, contentBounds, createMarble } from './physics';
import {
  COLORS,
  MARBLE_BY_ID,
  MARBLE_TYPES,
  NOTE_COLORS,
  PALETTE,
  PIECE_BY_ID,
  SHOP_ITEMS,
  STARTING_OWNED,
  FACTORY_OUTLET,
  defaultLen,
  getPieceDef,
  makePiece,
  pieceContains,
  pieceHitSize,
  piecePorts
} from './pieces';
import type { UI } from './ui';
import { CAMERA_TILT, clamp, nowMs, prefersReducedMotion, vibrate } from './util';
import { WORLD_THEMES } from './worlds';

const SAVE_KEY = 'marblelous.save.v1';
const BACKUP_KEY = 'marblelous.backup.v1';
const SNAPSHOTS_KEY = 'marblelous.snapshots.v1';
const MAX_SNAPSHOTS = 5;
/** La canica de cristal es la canica azul del juego. */
const BLUE_MARBLE = 'crystal';
const FIXED = 1 / 120;

interface DropStats {
  sparks: number;
  notes: Set<number>;
  goals: number;
  maxCombo: number;
  maxSpeed: number;
  airTime: number;
}

export type Ghost =
  | { kind: 'piece'; defId: string; x: number; y: number; rot: number }
  | { kind: 'marble'; typeId: string; x: number; y: number };

type History =
  | { type: 'add'; piece: Piece }
  | { type: 'remove'; piece: Piece }
  | { type: 'move'; id: number; fromX: number; fromY: number; toX: number; toY: number; fromRot: number; toRot: number }
  | { type: 'rotate'; id: number; from: number; to: number }
  | { type: 'size'; id: number; from: number; to: number }
  | { type: 'clear'; pieces: Piece[] };

export class Game {
  canvas: HTMLCanvasElement;
  audio: AudioEngine;
  renderer: { render: (alpha: number, now: number) => void; flash?: () => void } | null = null;
  ui: UI | null = null;

  physics = new PhysicsWorld();
  pieces: Piece[] = [];
  marbles: Marble[] = [];
  particles: Particle[] = [];
  popups: Popup[] = [];
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  alpha = 0;

  mode: Mode = 'build';
  armedDefId = '';
  armedSticky = false;
  selectedPieceId = 0;
  selectedMarble = 'crystal';
  ghost: Ghost | null = null;
  dropPreview: { x: number; y: number } | null = null;
  timeScale = 1;
  slowUntil = 0;
  overlayOpen = false;
  hidden = false;
  private overlayPaused = false;

  currency = 0;
  lifetime = 0;
  owned = new Set<string>(STARTING_OWNED);
  worlds: WorldData[] = [];
  activeWorld = 0;
  /** Últimas partidas borradas; la más reciente al final. */
  snapshots: SaveData[] = [];
  records: Records = {
    combo: 1,
    speed: 0,
    airTime: 0,
    marbles: 0,
    bestDrop: 0,
    goals: 0
  };
  settings: Settings = {
    quality: 'auto',
    haptics: false
  };

  comboChain = 0;
  comboMultiplier = 1;
  comboAt = -10000;
  private history: History[] = [];
  private redoStack: History[] = [];
  private nextId = 1;
  private nextMarbleId = 1;
  private accumulator = 0;
  private last = 0;
  private lastSave = 0;
  private dirty = false;
  private lastSpawn = 0;
  private dropActive = false;
  private dropId = 0;
  private dropStats: DropStats = this.emptyStats();
  private cooldowns = new Map<string, number>();
  private lastUiSave = 0;
  private lastSnapKey = '';
  private lastSnapAt = 0;
  private dragStartRot = 0;
  private viewInitialized = false;
  fresh = false;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.canvas = canvas;
    this.audio = audio;
    this.load();
    this.loadSnapshots();
    this.physics.rebuild(this.pieces);
    this.applySettings();
    this.bindVisibility();
  }

  get isPaused() {
    return this.overlayOpen || this.hidden;
  }

  get selectedPiece(): Piece | null {
    return this.pieces.find((p) => p.id === this.selectedPieceId) ?? null;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  private emptyStats(): DropStats {
    return {
      sparks: 0,
      notes: new Set<number>(),
      goals: 0,
      maxCombo: 1,
      maxSpeed: 0,
      airTime: 0
    };
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  frame = (now: number) => {
    const raw = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.isPaused) {
      this.updateTimeScale(now);
      this.accumulator += raw;
      let steps = 0;
      while (this.accumulator >= FIXED && steps < 12) {
        const simDt = FIXED * this.timeScale;
        this.updateBalances(simDt, now);
        this.physics.clearEvents();
        this.physics.update(this.marbles, simDt, now);
        this.processEvents(now);
        this.cleanupMarbles();
        this.accumulator -= FIXED;
        steps++;
      }
      if (steps >= 12) this.accumulator = 0;
      this.updateFactories(now);
      this.updateEffects(raw * this.timeScale, now);
      this.updateBubbles(now);
      this.updateDrop(now);
      this.updateRecords(now);
      this.maybeSave(now);
    }
    this.alpha = this.accumulator / FIXED;
    this.renderer?.render(this.alpha, now);
    this.ui?.tick(now);
    requestAnimationFrame(this.frame);
  };

  private bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hidden = true;
        this.save();
        this.audio.suspend();
      } else {
        this.hidden = false;
        this.accumulator = 0;
        this.last = performance.now();
        this.audio.resume();
      }
    });
    window.addEventListener('pagehide', () => {
      this.save();
      this.audio.suspend();
    });
    window.addEventListener('pageshow', () => {
      this.audio.resume();
      this.accumulator = 0;
      this.last = performance.now();
    });
    window.addEventListener('resize', () => {
      this.accumulator = 0;
      this.last = performance.now();
    });
  }

  setOverlayOpen(open: boolean) {
    this.overlayOpen = open;
    if (open) {
      this.save();
    } else {
      this.accumulator = 0;
      this.last = performance.now();
    }
    this.overlayPaused = open;
  }

  // ---------------- camera ----------------

  setViewport(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    if (!this.viewInitialized) {
      this.viewInitialized = true;
    }
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.viewW / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.viewH / 2) / this.camera.zoom / CAMERA_TILT + this.camera.y
    };
  }

  worldToScreen(wx: number, wy: number) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.viewW / 2,
      y: (wy - this.camera.y) * this.camera.zoom * CAMERA_TILT + this.viewH / 2
    };
  }

  panByScreen(dx: number, dy: number) {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom / CAMERA_TILT;
  }

  zoomAtScreen(sx: number, sy: number, zoom: number) {
    const nz = clamp(zoom, 0.3, 2.5);
    const old = this.camera.zoom;
    if (Math.abs(nz - old) < 0.0001) return;
    const px = (sx - this.viewW / 2) / old;
    const py = (sy - this.viewH / 2) / old / CAMERA_TILT;
    this.camera.x += px - (sx - this.viewW / 2) / nz;
    this.camera.y += py - (sy - this.viewH / 2) / nz / CAMERA_TILT;
    this.camera.zoom = nz;
  }

  recenter() {
    const b = contentBounds(this.pieces);
    if (!b) {
      this.camera = { x: 0, y: 0, zoom: 1 };
      return;
    }
    const w = Math.max(160, b.maxX - b.minX);
    const h = Math.max(160, b.maxY - b.minY);
    const zoom = clamp(Math.min((this.viewW - 120) / w, (this.viewH - 190) / (h * CAMERA_TILT)), 0.3, 1.2);
    this.camera.zoom = zoom;
    this.camera.x = (b.minX + b.maxX) / 2;
    this.camera.y = (b.minY + b.maxY) / 2;
    this.saveCamera();
  }

  saveCamera() {
    this.worlds[this.activeWorld].camera = { ...this.camera };
    this.requestSave();
  }

  // ---------------- mode / selection ----------------

  setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.armedDefId = '';
    this.armedSticky = false;
    this.selectedPieceId = 0;
    this.ghost = null;
    this.dropPreview = null;
    this.audio.ui();
    this.ui?.refreshTray();
    this.ui?.refreshMode();
    this.ui?.updateSelection();
    document.body.classList.remove('armed');
  }

  armPiece(defId: string, sticky = false) {
    if (!this.owned.has(defId)) return;
    if (this.armedDefId === defId) {
      this.disarmPiece();
      return;
    }
    this.armedDefId = defId;
    this.armedSticky = sticky;
    this.selectedPieceId = 0;
    this.mode = 'build';
    this.ghost = null;
    this.dropPreview = null;
    document.body.classList.add('armed');
    this.audio.ui();
    this.ui?.refreshTray();
    this.ui?.refreshMode();
    this.ui?.updateSelection();
  }

  disarmPiece() {
    if (!this.armedDefId) return;
    this.armedDefId = '';
    this.armedSticky = false;
    this.ghost = null;
    document.body.classList.remove('armed');
    this.ui?.refreshTray();
  }

  selectPiece(id: number) {
    this.selectedPieceId = id;
    this.ui?.updateSelection();
  }

  deselect() {
    if (!this.selectedPieceId) return;
    this.selectedPieceId = 0;
    this.ui?.updateSelection();
  }

  getPieceAt(wx: number, wy: number): Piece | null {
    const now = nowMs();
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      if (p.disabledUntil && p.disabledUntil > now) continue;
      if (pieceContains(p, wx, wy)) return p;
    }
    return null;
  }

  // ---------------- pieces ----------------

  addPiece(defId: string, x: number, y: number, rot = 0, commit = true): Piece | null {
    if (!this.owned.has(defId)) return null;
    if (this.pieces.length >= 2000) {
      this.audio.error();
      this.ui?.toast('info');
      return null;
    }
    const p = makePiece(this.nextId++, defId, x, y, rot);
    if (getPieceDef(defId).tintable) p.color = Math.floor(Math.random() * COLORS.length);
    if (commit) this.magnetSnap(p);
    this.pieces.push(p);
    this.physics.rebuild(this.pieces);
    if (commit) {
      this.history.push({ type: 'add', piece: p });
      this.history = this.history.slice(-60);
      this.redoStack.length = 0;
      this.dirty = true;
      this.requestSave();
      this.audio.impact('brick', 260, this.panForX(x));
      this.spawnBurst(x, y, PALETTE.blue, 5, 0);
    }
    this.selectPiece(p.id);
    this.ui?.refreshHud();
    return p;
  }

  removePiece(id: number) {
    const i = this.pieces.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.pieces.splice(i, 1);
    this.history.push({ type: 'remove', piece: p });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.selectedPieceId = 0;
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
    this.audio.ui();
    this.spawnBurst(p.x, p.y, PALETTE.muted, 5, 0);
    this.dirty = true;
    this.requestSave();
    this.ui?.updateSelection();
    this.ui?.refreshHud();
  }

  beginMove(p: Piece) {
    this.dragStartRot = p.rot;
    this.selectPiece(p.id);
  }

  movePieceTo(p: Piece, x: number, y: number) {
    p.x = Math.round(x / 20) * 20;
    p.y = Math.round(y / 20) * 20;
    this.magnetSnap(p);
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
  }

  /** Atrae el extremo de una pieza hacia el extremo compatible más cercano. */
  private magnetSnap(p: Piece, silent = false): boolean {
    if (p.defId === 'booster' && this.snapBoosterToTrack(p, silent)) return true;
    const ports = piecePorts(p);
    if (!ports.length) return false;
    let best: { d: number; ax: number; ay: number; bx: number; by: number; key: string } | null = null;
    const pc = Math.cos(p.rot);
    const ps = Math.sin(p.rot);
    for (const q of this.pieces) {
      if (q.id === p.id) continue;
      const qPorts = piecePorts(q);
      if (!qPorts.length) continue;
      const qc = Math.cos(q.rot);
      const qs = Math.sin(q.rot);
      for (let ai = 0; ai < ports.length; ai++) {
        const a = ports[ai];
        const ax = p.x + a.x * pc - a.y * ps;
        const ay = p.y + a.x * ps + a.y * pc;
        const adx = a.dx * pc - a.dy * ps;
        const ady = a.dx * ps + a.dy * pc;
        for (let bi = 0; bi < qPorts.length; bi++) {
          const b = qPorts[bi];
          const bx = q.x + b.x * qc - b.y * qs;
          const by = q.y + b.x * qs + b.y * qc;
          const bdx = b.dx * qc - b.dy * qs;
          const bdy = b.dx * qs + b.dy * qc;
          const d = Math.hypot(bx - ax, by - ay);
          if (d > 52) continue;
          if (adx * bdx + ady * bdy > -0.7) continue;
          if (!best || d < best.d) {
            best = { d, ax, ay, bx, by, key: `${q.id}:${ai}:${bi}` };
          }
        }
      }
    }
    if (!best) return false;
    p.x += best.bx - best.ax;
    p.y += best.by - best.ay;
    const now = performance.now();
    const key = `${p.id}:${best.key}`;
    if (!silent && (key !== this.lastSnapKey || now - this.lastSnapAt > 260)) {
      this.lastSnapKey = key;
      this.lastSnapAt = now;
      this.audio.clack(this.panForX(p.x));
      this.spawnBurst(p.x, p.y, '#FFF6D8', 3, 1);
    }
    return true;
  }

  /**
   * Los propulsores se imantan a cualquier punto de una rampa o cinta, no solo
   * a sus extremos, y quedan suspendidos justo encima de la pista.
   */
  private snapBoosterToTrack(p: Piece, silent: boolean): boolean {
    let best: { d: number; x: number; y: number; pieceId: number } | null = null;
    for (const q of this.pieces) {
      if (q.id === p.id) continue;
      let half = 0;
      let radius = 0;
      if (q.defId === 'ramp') {
        half = q.len / 2;
        radius = 8;
      } else if (q.defId === 'conveyor') {
        half = 160;
        radius = 8;
      } else if (q.defId === 'bubble') {
        half = 110;
        radius = 5;
      } else {
        continue;
      }
      const c = Math.cos(q.rot);
      const s = Math.sin(q.rot);
      const ax = q.x - half * c;
      const ay = q.y - half * s;
      const bx = q.x + half * c;
      const by = q.y + half * s;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1) continue;
      let t = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t;
      const py = ay + dy * t;
      const dRamp = Math.hypot(p.x - px, p.y - py);
      if (dRamp > 72) continue;
      // Normal hacia arriba (el propulsor queda por encima de la pista).
      const nl = Math.hypot(dx, dy) || 1;
      let nx = -dy / nl;
      let ny = dx / nl;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const off = 40 + radius + 1;
      const tx = px + nx * off;
      const ty = py + ny * off;
      if (!best || dRamp < best.d) best = { d: dRamp, x: tx, y: ty, pieceId: q.id };
    }
    if (!best) return false;
    p.x = best.x;
    p.y = best.y;
    const now = performance.now();
    const key = `${p.id}:boost:${best.pieceId}`;
    if (!silent && (key !== this.lastSnapKey || now - this.lastSnapAt > 260)) {
      this.lastSnapKey = key;
      this.lastSnapAt = now;
      this.audio.clack(this.panForX(p.x));
      this.spawnBurst(p.x, p.y, '#FFF6D8', 3, 1);
    }
    return true;
  }

  endMove(p: Piece, fromX: number, fromY: number) {
    if (Math.abs(p.x - fromX) < 0.1 && Math.abs(p.y - fromY) < 0.1) return;
    this.history.push({ type: 'move', id: p.id, fromX, fromY, toX: p.x, toY: p.y, fromRot: this.dragStartRot, toRot: p.rot });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.dirty = true;
    this.requestSave();
  }

  setPieceRot(p: Piece, rot: number, commit = false, from = 0) {
    p.rot = rot;
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
    if (commit && Math.abs(rot - from) > 0.001) {
      this.history.push({ type: 'rotate', id: p.id, from, to: rot });
      this.history = this.history.slice(-60);
      this.redoStack.length = 0;
      this.dirty = true;
      this.requestSave();
    }
  }

  setPieceLen(p: Piece, len: number, commit = false, from = 0) {
    p.len = len;
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
    if (commit && Math.abs(len - from) > 0.001) {
      this.history.push({ type: 'size', id: p.id, from, to: len });
      this.history = this.history.slice(-60);
      this.redoStack.length = 0;
      this.dirty = true;
      this.requestSave();
    }
  }

  private wakeMarbles() {
    for (const m of this.marbles) {
      if (m.alive && !m.awake) {
        m.awake = true;
        m.sleepTimer = 0;
      }
    }
  }

  private updateTimeScale(now: number) {
    if (this.timeScale >= 1) return;
    if (now < this.slowUntil) return;
    this.timeScale = 1;
    this.slowUntil = 0;
    this.ui?.flash(0.08);
  }

  /** Inclina los balancines según el peso de las canicas que tienen encima. */
  private updateBalances(dt: number, now: number) {
    let moved = false;
    for (const p of this.pieces) {
      if (p.defId !== 'balance') continue;
      const c = Math.cos(-p.rot);
      const s = Math.sin(-p.rot);
      let torque = 0;
      for (const m of this.marbles) {
        if (!m.alive || m.bubbled || m.ridePiece) continue;
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        const lx = dx * c - dy * s;
        const ly = dx * s + dy * c;
        if (Math.abs(lx) > 142 || ly < -72 || ly > 24) continue;
        const weight = ly < 12 ? 1 : 0.45;
        torque += m.mass * lx * weight;
      }
      const target = clamp(torque * 0.00055, -0.34, 0.34);
      const next = p.rot + (target - p.rot) * Math.min(1, dt * 10);
      if (Math.abs(next - p.rot) < 0.0002) continue;
      p.rot = next;
      moved = true;
      // Al moverse la barra hay que despertar las canicas que descansan encima.
      for (const m of this.marbles) {
        if (!m.alive || m.bubbled) continue;
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        const lx = dx * c - dy * s;
        const ly = dx * s + dy * c;
        if (Math.abs(lx) < 150 && ly > -70 && ly < 40 && !m.awake) {
          m.awake = true;
          m.sleepTimer = 0;
        }
      }
    }
    if (moved) this.physics.syncBalances(this.pieces);
  }

  togglePower(id: number) {
    const p = this.pieces.find((x) => x.id === id);
    if (!p) return;
    const pan = this.panForX(p.x);
    if (p.defId === 'electromagnet') {
      p.polarity = (p.polarity ?? 1) > 0 ? -1 : 1;
      this.physics.rebuild(this.pieces);
      this.wakeMarbles();
      this.audio.ui();
      this.audio.impact('metal', p.polarity > 0 ? 460 : 320, pan);
      this.spawnBurst(p.x, p.y, p.polarity > 0 ? PALETTE.teal : PALETTE.red, 8, 1);
    } else if (p.defId === 'marbleFactory') {
      p.powered = p.powered === false;
      p.emitAt = p.powered ? performance.now() + 420 : 0;
      this.audio.ui();
      this.audio.impact('metal', p.powered ? 520 : 300, pan);
      this.spawnBurst(p.x, p.y, p.powered ? PALETTE.green : PALETTE.red, 8, 1);
    } else {
      return;
    }
    this.dirty = true;
    this.requestSave();
    this.ui?.updateSelection();
    this.ui?.refreshHud();
  }

  duplicatePiece(p: Piece): Piece | null {
    if (this.pieces.length >= 2000) {
      this.audio.error();
      this.ui?.toast('info');
      return null;
    }
    const ports = piecePorts(p);
    let span = pieceHitSize(p).w + 4;
    if (ports.length) {
      const xs = ports.map((port) => port.x);
      span = Math.max(...xs) - Math.min(...xs) + 4;
    }
    const dx = Math.cos(p.rot) * span;
    const dy = Math.sin(p.rot) * span;
    const clone: Piece = {
      ...p,
      id: this.nextId++,
      x: p.x + dx,
      y: p.y + dy,
      bornAt: performance.now(),
      flash: undefined,
      anim: undefined,
      disabledUntil: undefined,
      charge: undefined,
      emitAt: undefined
    };
    this.pieces.push(clone);
    this.magnetSnap(clone, true);
    this.physics.rebuild(this.pieces);
    this.audio.clack(this.panForX(clone.x));
    this.history.push({ type: 'add', piece: clone });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.selectPiece(clone.id);
    this.audio.impact('brick', 240, this.panForX(clone.x));
    this.spawnBurst(clone.x, clone.y, PALETTE.yellow, 6, 0);
    this.dirty = true;
    this.requestSave();
    this.ui?.refreshHud();
    return clone;
  }

  clearCanvas() {
    if (this.pieces.length === 0 && this.marbles.length === 0) return;
    this.archiveGame();
    this.history.push({ type: 'clear', pieces: this.pieces });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.pieces = [];
    this.worlds[this.activeWorld].pieces = this.pieces;
    this.marbles = [];
    this.particles = [];
    this.popups = [];
    this.selectedPieceId = 0;
    this.armedDefId = '';
    this.ghost = null;
    this.dropPreview = null;
    this.timeScale = 1;
    this.slowUntil = 0;
    document.body.classList.remove('armed');
    this.physics.rebuild(this.pieces);
    this.physics.clearDisabled();
    this.audio.impact('brick', 300, 0);
    this.spawnBurst(this.camera.x, this.camera.y, PALETTE.muted, 12, 0);
    this.dirty = true;
    this.save();
    this.ui?.refreshAll();
    this.ui?.toast('trash');
  }

  /** Guarda el estado actual en la cola de partidas borradas. */
  private archiveGame() {
    this.snapshots.push(this.buildSaveData());
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
    }
    this.persistSnapshots();
  }

  loadSnapshot(index: number) {
    const snapshot = this.snapshots[index];
    if (!snapshot) return false;
    try {
      this.applySave(this.normalize(snapshot, this.defaults()));
    } catch {
      return false;
    }
    this.marbles = [];
    this.particles = [];
    this.popups = [];
    this.history = [];
    this.redoStack = [];
    this.selectedPieceId = 0;
    this.armedDefId = '';
    this.armedSticky = false;
    this.ghost = null;
    this.dropPreview = null;
    this.timeScale = 1;
    this.slowUntil = 0;
    this.dropActive = false;
    document.body.classList.remove('armed');
    this.physics.rebuild(this.pieces);
    this.physics.clearDisabled();
    this.dirty = true;
    this.save();
    this.ui?.refreshAll();
    return true;
  }

  private loadSnapshots() {
    try {
      const raw = localStorage.getItem(SNAPSHOTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      this.snapshots = parsed
        .filter((item): item is SaveData => !!item && typeof item === 'object' && Array.isArray((item as SaveData).worlds))
        .slice(-MAX_SNAPSHOTS);
    } catch {
      this.snapshots = [];
    }
  }

  private persistSnapshots() {
    try {
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(this.snapshots));
    } catch {
      /* sin espacio: las partidas guardadas siguen en memoria */
    }
  }

  undo() {
    const h = this.history.pop();
    if (!h) return;
    this.applyHistory(h, true);
    this.redoStack.push(h);
    this.dirty = true;
    this.requestSave();
    this.audio.ui();
    this.ui?.refreshHud();
  }

  redo() {
    const h = this.redoStack.pop();
    if (!h) return;
    this.applyHistory(h, false);
    this.history.push(h);
    this.dirty = true;
    this.requestSave();
    this.audio.ui();
    this.ui?.refreshHud();
  }

  private applyHistory(h: History, undo: boolean) {
    if (h.type === 'add') {
      if (undo) {
        this.pieces = this.pieces.filter((p) => p.id !== h.piece.id);
      } else if (!this.pieces.some((p) => p.id === h.piece.id)) {
        this.pieces.push(h.piece);
      }
    } else if (h.type === 'remove') {
      if (undo) {
        if (!this.pieces.some((p) => p.id === h.piece.id)) this.pieces.push(h.piece);
      } else {
        this.pieces = this.pieces.filter((p) => p.id !== h.piece.id);
      }
    } else if (h.type === 'move') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) {
        p.x = undo ? h.fromX : h.toX;
        p.y = undo ? h.fromY : h.toY;
        p.rot = undo ? h.fromRot : h.toRot;
      }
    } else if (h.type === 'rotate') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.rot = undo ? h.from : h.to;
    } else if (h.type === 'size') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.len = undo ? h.from : h.to;
    } else if (h.type === 'clear') {
      this.pieces = undo ? h.pieces : [];
    }
    this.selectedPieceId = 0;
    this.worlds[this.activeWorld].pieces = this.pieces;
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
    this.ui?.updateSelection();
    this.ui?.refreshTray();
  }

  // ---------------- marbles ----------------

  spawnMarble(x: number, y: number, typeId = this.selectedMarble) {
    let chosen = typeId;
    if (chosen === 'surprise') {
      const pool = MARBLE_TYPES.filter((t) => t.id !== 'surprise' && this.owned.has(t.id));
      chosen = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : 'crystal';
    }
    if (!this.owned.has(chosen)) return null;
    if (this.marbles.length >= 200) {
      const old = this.marbles.shift();
      if (old) {
        old.alive = false;
        this.spawnBurst(old.x, old.y, PALETTE.muted, 3, 0);
      }
    }
    const type = MARBLE_BY_ID.get(chosen) ?? MARBLE_TYPES[0];
    if (!this.dropActive) {
      this.dropActive = true;
      this.dropId++;
      this.dropStats = this.emptyStats();
    }
    const m = createMarble(this.nextMarbleId++, type, x, y, this.dropId, nowMs());
    this.marbles.push(m);
    this.lastSpawn = nowMs();
    if (this.selectedMarble !== 'surprise' && this.selectedMarble !== chosen) {
      this.selectedMarble = chosen;
      this.ui?.refreshTray();
    }
    this.records.marbles = Math.max(this.records.marbles, this.marbles.length);
    this.dropStats.maxSpeed = Math.max(this.dropStats.maxSpeed, 0);
    this.spawnBurst(x, y, type.color, 4, 0);
    this.dirty = true;
    return m;
  }


  private cleanupMarbles() {
    for (const m of this.marbles) {
      if (m.alive && (m.y > 90000 || m.y < -90000 || Math.abs(m.x) > 90000)) m.alive = false;
    }
    for (const m of this.marbles) {
      if (m.alive) continue;
      const i = this.marbles.indexOf(m);
      if (i >= 0) this.marbles.splice(i, 1);
    }
    let sleeping = 0;
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      if (m.awake) continue;
      sleeping++;
      if (sleeping > 80) {
        m.alive = false;
        this.marbles.splice(i, 1);
      }
    }
  }

  // ---------------- scoring / events ----------------

  private allow(key: string, ms: number, now: number) {
    const last = this.cooldowns.get(key) ?? -1e9;
    if (now - last < ms) return false;
    this.cooldowns.set(key, now);
    if (this.cooldowns.size > 800) {
      for (const [k, v] of this.cooldowns) {
        if (now - v > 6000) this.cooldowns.delete(k);
      }
    }
    return true;
  }

  private panForX(x: number) {
    return clamp((x - this.camera.x) / (this.viewW / 2 / this.camera.zoom), -1, 1);
  }

  private processEvents(now: number) {
    for (const e of this.physics.events) {
      const pan = this.panForX(e.x);
      if (e.type === 'chime') {
        if (!this.allow(`chime:${e.pieceId}`, 88, now)) continue;
        const p = this.pieces.find((x) => x.id === e.pieceId);
        if (p) {
          p.flash = now;
          p.flashNote = e.note;
        }
        this.audio.playChime(e.note, e.impact, pan);
        this.spawnBurst(e.x, e.y, NOTE_COLORS[e.note] ?? PALETTE.yellow, 5, 1);
        this.dropStats.notes.add(e.note);
        this.score(5, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'hourglass') {
        const p = this.pieces.find((x) => x.id === e.pieceId);
        this.slowUntil = Math.max(this.slowUntil, now + 5000);
        this.timeScale = 0.35;
        const respawn = this.slowUntil + 5000;
        for (const q of this.pieces) {
          if (q.defId !== 'hourglass') continue;
          if (q.disabledUntil && q.disabledUntil > now) q.disabledUntil = Math.max(q.disabledUntil, respawn);
        }
        for (const t of this.physics.triggers) {
          if (t.kind !== 'hourglass') continue;
          if (t.disabledUntil > now) t.disabledUntil = Math.max(t.disabledUntil, respawn);
        }
        if (p) {
          p.disabledUntil = Math.max(p.disabledUntil ?? 0, respawn);
          if (this.selectedPieceId === p.id) {
            this.selectedPieceId = 0;
            this.ui?.updateSelection();
          }
        }
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.yellow, 18, 2);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 12, 1);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 8, 0);
        this.score(25, e.x, e.y, e.marbleId, now);
        this.ui?.flash(0.18);
      } else if (e.type === 'bumper') {
        if (!this.allow(`bump:${e.marbleId}:${e.pieceId}`, 240, now)) continue;
        const p = this.pieces.find((x) => x.id === e.pieceId);
        if (p) p.flash = now;
        this.audio.bumper(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 6, 1);
        this.score(10, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'cannon') {
        this.audio.cannon(pan);
        this.spawnBurst(e.x, e.y, PALETTE.purple, 5, 0);
        this.score(2, e.x, e.y, e.marbleId, now);
        const m = this.marbles.find((x) => x.id === e.marbleId);
        if (m && m.alive && m.typeId === 'plasma') this.splitPlasma(m, e, now);
      } else if (e.type === 'boost') {
        if (!this.allow(`boost:${e.marbleId}:${e.pieceId}`, 500, now)) continue;
        this.audio.boost(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 3, 0);
        this.score(2, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'spiral') {
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 8, 1);
      } else if (e.type === 'bubble') {
        this.audio.bubble(pan);
        this.spawnBurst(e.x, e.y, '#8FD3EE', 12, 1);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 6, 0);
        this.score(6, e.x, e.y, e.marbleId, now);
        this.bubbleBlueMarbles(e.marbleId);
      } else if (e.type === 'pop') {
        this.audio.pop(pan);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 8, 0);
        this.spawnBurst(e.x, e.y, '#8FD3EE', 7, 1);
        this.score(3, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'portal') {
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.purple, 10, 1);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 6, 0);
        this.score(5, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'goal') {
        const m = this.marbles.find((x) => x.id === e.marbleId);
        this.audio.goal(pan);
        const p = this.pieces.find((x) => x.id === e.pieceId);
        if (p) p.anim = now;
        this.spawnConfetti(e.x, e.y - 20);
        this.dropStats.goals++;
        this.records.goals++;
        this.score(120, e.x, e.y, e.marbleId, now);
        if (m) m.alive = false;
        this.ui?.flash(0.22);
        if (this.settings.haptics) vibrate(18);
      } else if (e.type === 'star') {
        this.audio.star(pan);
        this.spawnBurst(e.x, e.y, PALETTE.yellow, 12, 1);
        const p = this.pieces.find((x) => x.id === e.pieceId);
        if (p) p.disabledUntil = now + 5000;
        this.score(15, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'air') {
        const secs = e.impact / 1000;
        const pts = Math.min(60, Math.round((secs - 1.2) * 20));
        this.dropStats.airTime = Math.max(this.dropStats.airTime, e.impact);
        this.records.airTime = Math.max(this.records.airTime, e.impact);
        if (pts > 0) this.score(pts, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'marble') {
        if (!this.allow(`marble:${e.marbleId}`, 100, now)) continue;
        this.audio.impact('brick', e.impact * 0.55, pan);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 2, 0);
      } else if (e.type === 'rainbow') {
        this.spawnFireworks(e.x, e.y, 3);
        this.audio.firework(pan);
        this.score(80, e.x, e.y, e.marbleId, now);
        this.ui?.flash(0.3);
      }
    }
  }

  /** La canica plasma se parte en dos al caer en un cañón. */
  private splitPlasma(m: Marble, e: PhysEvent, now: number) {
    if (this.marbles.length >= 200) return;
    const type = MARBLE_BY_ID.get('plasma');
    if (!type) return;
    const speed = Math.hypot(m.vx, m.vy);
    const ang = Math.atan2(m.vy, m.vx);
    const spread = 0.3;
    m.vx = Math.cos(ang - spread) * speed;
    m.vy = Math.sin(ang - spread) * speed;
    m.lastCannon = now;
    m.lastCannonPiece = e.pieceId;
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const clone = createMarble(
      this.nextMarbleId++,
      type,
      e.x + nx * m.r * 1.2,
      e.y + ny * m.r * 1.2,
      this.dropId,
      now
    );
    clone.vx = Math.cos(ang + spread) * speed;
    clone.vy = Math.sin(ang + spread) * speed;
    clone.lastCannon = now;
    clone.lastCannonPiece = e.pieceId;
    clone.awake = true;
    this.marbles.push(clone);
    this.spawnBurst(e.x, e.y, type.color, 8, 1);
    this.spawnBurst(e.x, e.y, type.glow ?? PALETTE.teal, 6, 0);
    this.records.marbles = Math.max(this.records.marbles, this.marbles.length);
    this.dirty = true;
  }

  /** Al entrar una canica azul en una burbuja, todas las azules del lienzo suben con ella. */
  private bubbleBlueMarbles(triggerId: number) {
    const trigger = this.marbles.find((m) => m.id === triggerId);
    if (!trigger || trigger.typeId !== BLUE_MARBLE) return;
    for (const m of this.marbles) {
      if (m.id === triggerId || !m.alive || m.bubbled || m.typeId !== BLUE_MARBLE) continue;
      m.bubbled = true;
      m.bubbleT = 0;
      m.vx *= 0.25;
      m.vy = -40;
      m.contact = 0;
      m.airTime = 0;
      m.sleepTimer = 0;
      m.ridePiece = 0;
      m.rideT = 0;
      m.rideScale = 1;
      m.rideDepth = 0;
      m.awake = true;
      this.spawnBurst(m.x, m.y, '#8FD3EE', 10, 1);
      this.spawnBurst(m.x, m.y, PALETTE.paper3, 4, 0);
    }
  }

  private score(base: number, x: number, y: number, marbleId: number, now: number) {
    if (now - this.comboAt > 2500) this.comboChain = 0;
    this.comboAt = now;
    this.comboChain++;
    this.comboMultiplier = Math.min(5, 1 + 0.25 * Math.floor(this.comboChain / 5));
    const m = this.marbles.find((mm) => mm.id === marbleId);
    const type = m ? MARBLE_BY_ID.get(m.typeId) : undefined;
    const bonus = type?.bonus ?? 1;
    const pts = Math.max(1, Math.round(base * this.comboMultiplier * bonus));
    this.currency += pts;
    this.lifetime += pts;
    this.dropStats.sparks += pts;
    this.dropStats.maxCombo = Math.max(this.dropStats.maxCombo, this.comboMultiplier);
    this.records.combo = Math.max(this.records.combo, this.comboMultiplier);
    this.spawnPopup(x, y - 14, `+${pts}`);
    this.dirty = true;
    this.ui?.refreshHud();
  }

  private updateRecords(now: number) {
    let max = 0;
    for (const m of this.marbles) {
      if (!m.alive) continue;
      const s = Math.hypot(m.vx, m.vy);
      if (s > max) max = s;
      if (typeIsPremium(m)) {
        m.trailAcc += 1 / 60;
        if (m.trailAcc > 0.035) {
          m.trailAcc = 0;
          m.trail.unshift(m.x, m.y);
          if (m.trail.length > 24) m.trail.length = 24;
        }
      }
    }
    if (max > this.records.speed) {
      this.records.speed = max;
      this.dirty = true;
    }
    if (this.dropStats.maxSpeed < max) this.dropStats.maxSpeed = max;
    if (now - this.comboAt > 2500 && this.comboChain !== 0) {
      this.comboChain = 0;
      this.ui?.refreshHud();
    }
    if (now - this.lastUiSave > 500) {
      this.lastUiSave = now;
      this.ui?.refreshHud();
    }
  }

  private addBonus(points: number, x: number, y: number) {
    this.currency += points;
    this.lifetime += points;
    this.dropStats.sparks += points;
    this.spawnPopup(x, y - 16, `+${points}`);
    this.ui?.refreshHud();
    this.dirty = true;
    this.requestSave();
  }

  /** Las fábricas de canicas encendidas emiten una canica por segundo. */
  private updateFactories(now: number) {
    for (const p of this.pieces) {
      if (p.defId !== 'marbleFactory') continue;
      if (p.powered === false) {
        p.emitAt = 0;
        continue;
      }
      if (!p.emitAt) {
        p.emitAt = now + 380;
        continue;
      }
      if (now < p.emitAt) continue;
      p.emitAt = now + 1000;
      this.emitFactoryMarble(p, now);
    }
  }

  private emitFactoryMarble(p: Piece, now: number) {
    if (this.marbles.length >= 200) return;
    let typeId = this.selectedMarble;
    if (typeId === 'surprise') {
      const pool = MARBLE_TYPES.filter((t) => t.id !== 'surprise' && this.owned.has(t.id));
      typeId = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : BLUE_MARBLE;
    }
    const type = MARBLE_BY_ID.get(typeId) ?? MARBLE_BY_ID.get(BLUE_MARBLE) ?? MARBLE_TYPES[0];
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const x = p.x + FACTORY_OUTLET.x * c - FACTORY_OUTLET.y * s;
    const y = p.y + FACTORY_OUTLET.x * s + FACTORY_OUTLET.y * c;
    const m = createMarble(this.nextMarbleId++, type, x, y, this.dropId, now);
    m.vx = (Math.random() - 0.5) * 24;
    m.vy = 30;
    m.auto = true;
    this.marbles.push(m);
    p.anim = now;
    this.records.marbles = Math.max(this.records.marbles, this.marbles.length);
    this.spawnBurst(x, y, type.color, 3, 0);
    this.audio.impact('metal', 300, this.panForX(x));
    this.dirty = true;
  }

  private updateBubbles(now: number) {
    for (const p of this.pieces) {
      if (p.defId !== 'bubble') continue;
      if (p.disabledUntil && p.disabledUntil > now) {
        p.charge = 0;
        p.anim = undefined;
        continue;
      }
      let weight = 0;
      const c = Math.cos(-p.rot);
      const s = Math.sin(-p.rot);
      for (const m of this.marbles) {
        if (!m.alive || !m.awake) continue;
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        const lx = dx * c - dy * s;
        const ly = dx * s + dy * c;
        if (Math.abs(lx) < 128 && Math.abs(ly) < 38) weight++;
      }
      p.charge = weight;
      if (weight > 0) {
        if (!p.anim) p.anim = now;
        if (now - p.anim > 220) this.explodeBubble(p, now);
      } else {
        p.anim = undefined;
      }
    }
  }

  private explodeBubble(p: Piece, now: number) {
    p.disabledUntil = now + 6000;
    p.charge = 0;
    p.anim = undefined;
    this.physics.setPieceDisabled(p.id, now + 6000);
    for (const m of this.marbles) {
      if (!m.alive) continue;
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      if (Math.abs(dx) < 150 && Math.abs(dy) < 50) {
        m.vy += 110;
        m.awake = true;
        m.sleepTimer = 0;
      }
    }
    const pan = this.panForX(p.x);
    this.audio.impact('metal', 650, pan);
    this.audio.bubble(pan);
    this.spawnBurst(p.x, p.y, '#BFE9FF', 18, 2);
    this.spawnBurst(p.x, p.y, PALETTE.paper3, 8, 2);
    this.spawnBurst(p.x, p.y, PALETTE.teal, 6, 1);
    this.addBonus(30, p.x, p.y);
    this.ui?.flash(0.12);
  }

  private updateDrop(now: number) {
    if (!this.dropActive) return;
    if (this.marbles.length === 0) {
      if (now - this.lastSpawn > 1400) this.endDrop();
      return;
    }
    let awake = false;
    for (const m of this.marbles) if (m.alive && m.awake && !m.auto) awake = true;
    if (!awake && now - this.lastSpawn > 2200) this.endDrop();
  }

  private endDrop() {
    if (!this.dropActive) return;
    this.dropActive = false;
    const stats = this.dropStats;
    this.records.bestDrop = Math.max(this.records.bestDrop, stats.sparks);
    if (stats.sparks > 0 || stats.notes.size > 0) {
      const summary: DropSummary = {
        sparks: stats.sparks,
        notes: stats.notes.size,
        goals: stats.goals,
        bestCombo: stats.maxCombo
      };
      this.ui?.showSummary(summary);
    }
    this.dirty = true;
    this.requestSave();
  }

  // ---------------- effects ----------------

  spawnBurst(x: number, y: number, color: string, count: number, kind: number, scale = 1) {
    const reduce = prefersReducedMotion();
    const n = reduce ? Math.min(4, count) : count;
    const grow = Math.min(3, Math.max(1, scale));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 140) * grow;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30 * grow,
        life: (0.45 + Math.random() * 0.45) * (1 + (grow - 1) * 0.2),
        maxLife: 0.9 * (1 + (grow - 1) * 0.2),
        size: (2 + Math.random() * 3) * grow,
        color,
        kind,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        alpha: 1
      });
    }
    if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
  }

  private spawnFireworks(x: number, y: number, scale = 1) {
    const colors = [PALETTE.red, PALETTE.yellow, PALETTE.green, PALETTE.teal, PALETTE.purple, PALETTE.pink];
    const spread = 22 * scale;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.spawnBurst(x + Math.cos(a) * spread, y + Math.sin(a) * spread - 10 * scale, colors[i], 9, 1, scale);
    }
    this.spawnBurst(x, y - 10 * scale, PALETTE.paper3, 10, 1, scale);
    this.spawnConfetti(x, y - 24 * scale, scale);
    this.ui?.toast('spark', '¡Fuegos!');
  }

  spawnConfetti(x: number, y: number, scale = 1) {
    const reduce = prefersReducedMotion();
    const n = reduce ? 5 : 20;
    const colors = [PALETTE.red, PALETTE.yellow, PALETTE.teal, PALETTE.green, PALETTE.pink, PALETTE.blue];
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 360 * scale,
        vy: (-120 - Math.random() * 260) * scale,
        life: 1.1 + Math.random() * 0.7,
        maxLife: 1.8,
        size: (3 + Math.random() * 4) * scale,
        color: colors[i % colors.length],
        kind: 3,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        alpha: 1
      });
    }
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  spawnPopup(x: number, y: number, text: string) {
    this.popups.push({
      x,
      y,
      text,
      life: 0.95,
      maxLife: 0.95,
      color: PALETTE.ink,
      size: 18
    });
    if (this.popups.length > 7) this.popups.shift();
  }

  private updateEffects(dt: number, now: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-1.4 * dt);
      p.rot += p.vr * dt;
      p.alpha = Math.min(1, p.life / 0.2);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y -= 26 * dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    // trim trails of sleeping marbles
    for (const m of this.marbles) {
      if (!m.awake && m.trail.length > 0 && now - m.bornAt > 2000) {
        m.trail.length = 0;
      }
    }
  }

  private maybeSave(now: number) {
    if (!this.dirty) return;
    if (now - this.lastSave > 900) this.save();
  }

  requestSave() {
    this.dirty = true;
  }

  // ---------------- economy / rewards ----------------

  isOwned(id: string) {
    return this.owned.has(id);
  }

  // ---------------- settings ----------------

  applySettings() {
    this.audio.setLevel(2);
  }

  cycleQuality() {
    const order: Settings['quality'][] = ['auto', 'high', 'low'];
    const i = order.indexOf(this.settings.quality);
    this.settings.quality = order[(i + 1) % order.length];
    this.dirty = true;
    this.requestSave();
    this.ui?.refreshSettings();
    this.audio.ui();
  }

  toggleHaptics() {
    this.settings.haptics = !this.settings.haptics;
    this.dirty = true;
    this.requestSave();
    this.ui?.refreshSettings();
    this.audio.ui();
  }

  setWorld(i: number) {
    if (i === this.activeWorld || i < 0 || i >= this.worlds.length) return;
    this.activeWorld = i;
    this.dirty = true;
    this.save();
    this.ui?.refreshSettings();
  }

  resetProgress() {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(BACKUP_KEY);
      localStorage.removeItem(SNAPSHOTS_KEY);
    } catch {
      /* noop */
    }
    location.reload();
  }

  // ---------------- persistence ----------------

  private load() {
    const fallback = this.defaults();
    this.fresh = false;
    let data: SaveData | null = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw) as SaveData;
    } catch {
      data = null;
    }
    if (!data) {
      try {
        const raw = localStorage.getItem(BACKUP_KEY);
        if (raw) data = JSON.parse(raw) as SaveData;
      } catch {
        data = null;
      }
    }
    if (!data || typeof data !== 'object') {
      this.fresh = true;
      this.applySave(fallback);
      return;
    }
    try {
      this.applySave(this.normalize(data, fallback));
    } catch {
      this.fresh = true;
      this.applySave(fallback);
    }
  }

  private defaults(): SaveData {
    const empty = (): WorldData => ({
      pieces: [],
      camera: { x: 0, y: 0, zoom: 1 },
      records: { combo: 1, speed: 0, airTime: 0, marbles: 0, bestDrop: 0, goals: 0 }
    });
    const space = Math.max(0, WORLD_THEMES.findIndex((t) => t.kind === 'space'));
    return {
      v: 1,
      updatedAt: Date.now(),
      currency: 0,
      lifetime: 0,
      owned: [...STARTING_OWNED],
      activeWorld: space,
      worlds: WORLD_THEMES.map(() => empty()),
      settings: {
        quality: 'auto',
        haptics: false
      },
      selectedMarble: 'crystal'
    };
  }

  private normalize(data: SaveData, fallback: SaveData): SaveData {
    const worlds: WorldData[] = [];
    for (let i = 0; i < WORLD_THEMES.length; i++) {
      const w = data.worlds?.[i] ?? fallback.worlds[i];
      const pieces: Piece[] = [];
      for (const raw of w.pieces ?? []) {
        if (!raw || !PIECE_BY_ID.has(raw.defId)) continue;
        const p: Piece = {
          id: Number(raw.id) || pieces.length + 1,
          defId: raw.defId,
          x: Number(raw.x) || 0,
          y: Number(raw.y) || 0,
          rot: Number(raw.rot) || 0,
          len: Number(raw.len) || defaultLen(raw.defId),
          color: Number.isFinite(raw.color) ? raw.color : getPieceDef(raw.defId).defaultColor,
          variant: Number(raw.variant) || 0,
          polarity: raw.defId === 'electromagnet' && Number(raw.polarity) < 0 ? -1 : undefined,
          powered: raw.defId === 'marbleFactory' ? raw.powered !== false : undefined
        };
        pieces.push(p);
      }
      const rec = {
        combo: Math.max(1, Number(w.records?.combo) || 1),
        speed: Math.max(0, Number(w.records?.speed) || 0),
        airTime: Math.max(0, Number(w.records?.airTime) || 0),
        marbles: Math.max(0, Number(w.records?.marbles) || 0),
        bestDrop: Math.max(0, Number(w.records?.bestDrop) || 0),
        goals: Math.max(0, Number(w.records?.goals) || 0)
      };
      worlds.push({
        pieces,
        camera: {
          x: Number(w.camera?.x) || 0,
          y: Number(w.camera?.y) || 0,
          zoom: clamp(Number(w.camera?.zoom) || 1, 0.3, 2.5)
        },
        records: rec
      });
    }
    const owned = new Set<string>(STARTING_OWNED);
    for (const id of data.owned ?? []) if (PIECE_BY_ID.has(id) || MARBLE_BY_ID.has(id)) owned.add(id);
    return {
      v: 1,
      updatedAt: Date.now(),
      currency: Math.max(0, Number(data.currency) || 0),
      lifetime: Math.max(0, Number(data.lifetime) || 0),
      owned: [...owned],
      activeWorld: clamp(Number(data.activeWorld) || 0, 0, WORLD_THEMES.length - 1),
      worlds,
      settings: {
        quality: (data.settings?.quality ?? fallback.settings.quality) as Settings['quality'],
        haptics: !!(data.settings?.haptics ?? fallback.settings.haptics)
      },
      selectedMarble: MARBLE_BY_ID.has(data.selectedMarble) ? data.selectedMarble : 'crystal'
    };
  }

  private applySave(data: SaveData) {
    this.currency = data.currency;
    this.lifetime = data.lifetime;
    this.owned = new Set(data.owned);
    for (const id of STARTING_OWNED) this.owned.add(id);
    this.worlds = data.worlds;
    this.activeWorld = data.activeWorld;
    const active = this.worlds[this.activeWorld];
    const source = active.pieces.length ? active : this.worlds.find((w) => w.pieces.length) ?? active;
    this.pieces = source.pieces;
    this.camera = source.camera ?? { x: 0, y: 0, zoom: 1 };
    this.records = source.records ?? {
      combo: 1,
      speed: 0,
      airTime: 0,
      marbles: 0,
      bestDrop: 0,
      goals: 0
    };
    if (source !== active) {
      active.pieces = source.pieces;
      active.camera = source.camera;
      active.records = source.records;
    }
    this.settings = data.settings;
    this.selectedMarble = data.selectedMarble;
    this.nextId = Math.max(0, ...this.pieces.map((p) => p.id)) + 1;
  }

  /** Instantánea serializable del estado actual (sin modificar los mundos). */
  private buildSaveData(): SaveData {
    const activeIndex = this.activeWorld;
    return {
      v: 1,
      updatedAt: Date.now(),
      currency: this.currency,
      lifetime: this.lifetime,
      owned: [...this.owned],
      activeWorld: this.activeWorld,
      worlds: this.worlds.map((w, i) => {
        const pieces = i === activeIndex ? this.pieces : w.pieces;
        return {
          pieces: pieces.map((p) => ({
            id: p.id,
            defId: p.defId,
            x: Math.round(p.x * 10) / 10,
            y: Math.round(p.y * 10) / 10,
            rot: Math.round(p.rot * 1000) / 1000,
            len: p.len,
            color: p.color,
            variant: p.variant,
            polarity: p.defId === 'electromagnet' ? (p.polarity ?? 1) : undefined,
            powered: p.defId === 'marbleFactory' ? p.powered !== false : undefined
          })),
          camera: i === activeIndex ? { ...this.camera } : { ...w.camera },
          records: i === activeIndex ? { ...this.records } : { ...w.records }
        };
      }),
      settings: { ...this.settings },
      selectedMarble: this.selectedMarble
    };
  }

  save() {
    const active = this.worlds[this.activeWorld];
    for (const w of this.worlds) {
      if (w !== active) w.pieces = [];
    }
    active.pieces = this.pieces;
    active.camera = { ...this.camera };
    active.records = this.records;
    const data = this.buildSaveData();
    try {
      const prev = localStorage.getItem(SAVE_KEY);
      if (prev) localStorage.setItem(BACKUP_KEY, prev);
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.lastSave = performance.now();
      this.dirty = false;
    } catch {
      this.ui?.toast('info');
    }
  }
}

function typeIsPremium(m: Marble) {
  const t = MARBLE_BY_ID.get(m.typeId);
  return !!t?.premium;
}
