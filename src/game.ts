import type {
  Camera,
  Marble,
  Mode,
  Particle,
  PhysEvent,
  Piece,
  Settings,
  Vec2,
  Workshop
} from './types';
import { ALBUM_KEY, DEFAULT_SETTINGS, findAlbum, newCamera, NORMAL_THEME, savedPiece } from './album';
import { AudioEngine } from './audio';
import { PhysicsWorld, contentBounds, createMarble } from './physics';
import {
  COLORS,
  MARBLE_BY_ID,
  MARBLE_TYPES,
  NOTE_COLORS,
  PALETTE,
  PIECE_BY_ID,
  FACTORY_OUTLET,
  METER_INTERVALS,
  getPieceDef,
  makePiece,
  pieceContains,
  pieceHitSize,
  pieceLength,
  piecePorts,
  xyloNotes
} from './pieces';
import { findSnap, type Snap } from './snap';
import type { UI } from './ui';
import { CAMERA_TILT, clamp, nowMs, prefersReducedMotion, vibrate } from './util';
import { WORLD_THEMES } from './worlds';
import { FIRST_DROP, type StructurePiece } from './structures';

/** La canica de cristal es la canica azul del juego. */
const BLUE_MARBLE = 'crystal';
const FIXED = 1 / 120;
const SURPRISE_MARBLES = MARBLE_TYPES.filter((type) => type.id !== 'surprise');

type History =
  | { type: 'add'; piece: Piece }
  | { type: 'remove'; piece: Piece }
  | { type: 'move'; id: number; from: Vec2; to: Vec2 }
  | { type: 'rotate'; id: number; from: number; to: number }
  | { type: 'size'; id: number; from: number; to: number }
  | { type: 'tempo'; id: number; from: number; to: number }
  | { type: 'notes'; id: number; from: number[]; to: number[] }
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
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  alpha = 0;

  mode: Mode = 'build';
  armedDefId = '';
  armedSticky = false;
  selectedPieceId = 0;
  testDropArmed = false;
  selectedMarble = 'crystal';
  ghost: Piece | null = null;
  snap: Snap | null = null;
  snapRipple: (Vec2 & { at: number }) | null = null;
  dropPreview: { x: number; y: number } | null = null;
  timeScale = 1;
  slowUntil = 0;
  overlayOpen = false;
  hidden = false;
  simulationPaused = false;

  workshops: Workshop[] = [];
  workshop!: Workshop;
  settings: Settings = { ...DEFAULT_SETTINGS };
  introMarbleId = 0;
  private introTrialUntil = 0;

  private history: History[] = [];
  private redoStack: History[] = [];
  private nextId = 1;
  private nextMarbleId = 1;
  private accumulator = 0;
  private last = 0;
  private lastSave = 0;
  private dirty = false;
  private cooldowns = new Map<string, number>();
  private lastSnapAt = -Infinity;
  private moveOrigin: (Vec2 & { id: number }) | null = null;
  private physicsDirty = false;
  private hudDirty = false;
  private saveIdlePending = false;
  private balances: Piece[] = [];
  private factories: Piece[] = [];
  private fragileRamps: Piece[] = [];
  private pieceById = new Map<number, Piece>();
  private sceneBottom = 0;
  /** Cambia cuando el orden por profundidad de las piezas puede haber cambiado. */
  pieceRevision = 0;
  fresh = false;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.canvas = canvas;
    this.audio = audio;
    this.load();
    this.bindVisibility();
  }

  get isPaused() {
    return this.overlayOpen || this.hidden;
  }

  get selectedPiece(): Piece | null {
    return this.pieceById.get(this.selectedPieceId) ?? null;
  }

  get activeWorld(): number {
    return this.workshop.theme;
  }

  private rebuildPhysics() {
    this.physicsDirty = false;
    this.balances.length = 0;
    this.factories.length = 0;
    this.fragileRamps.length = 0;
    this.pieceById.clear();
    for (const piece of this.pieces) {
      this.pieceById.set(piece.id, piece);
      if (piece.defId === 'balance') this.balances.push(piece);
      else if (piece.defId === 'marbleFactory') this.factories.push(piece);
      else if (piece.defId === 'bubble') this.fragileRamps.push(piece);
    }
    this.sceneBottom = contentBounds(this.pieces)?.maxY ?? 0;
    this.physics.rebuild(this.pieces);
  }

  private requestHud() {
    this.hudDirty = true;
  }

  private bumpPieces() {
    this.pieceRevision++;
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  frame = (now: number) => {
    const raw = Math.min(Math.max(0, (now - this.last) / 1000), 8 * FIXED);
    this.last = now;
    if (!this.isPaused) {
      if (this.physicsDirty) this.rebuildPhysics();
      if (!this.simulationPaused) {
        this.updateTimeScale(now);
        this.accumulator += raw;
        while (this.accumulator >= FIXED) {
          const simDt = FIXED * this.timeScale;
          if (this.marbles.length || this.balances.length) {
            this.updateBalances(simDt);
            this.physics.clearEvents();
            this.physics.update(this.marbles, simDt, now);
            this.processEvents(now);
          }
          this.accumulator -= FIXED;
        }
        if (this.marbles.length) {
          this.cleanupMarbles();
          this.updateTrails(raw);
        }
        this.updateFactories(now);
        this.updateBubbles(now);
        this.alpha = this.accumulator / FIXED;
      }
      this.updateEffects(raw * this.timeScale, now);
      if (this.introMarbleId && now >= this.introTrialUntil) this.introMarbleId = 0;
      this.maybeSave(now);
      if (this.hudDirty) {
        this.hudDirty = false;
        this.ui?.refreshHud();
      }
      this.renderer?.render(this.alpha, now);
      this.ui?.tick(now);
    }
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
  }

  toggleSimulation() {
    this.simulationPaused = !this.simulationPaused;
    this.accumulator = 0;
    this.alpha = 1;
    this.audio.ui();
    this.requestHud();
  }

  clearMarbles() {
    for (const m of this.marbles) m.alive = false;
    this.marbles.length = 0;
    this.introMarbleId = 0;
    this.physics.clearMeters();
    this.particles.length = 0;
    this.audio.ui();
  }

  // ---------------- camera ----------------

  setViewport(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
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
    this.requestSave();
  }

  startIntroMarble() {
    if ((this.workshop.intro !== 'drop' && this.workshop.intro !== 'again') || this.introMarbleId) return;
    const marble = this.spawnMarble(FIRST_DROP.x, FIRST_DROP.y);
    if (!marble) return;
    if (this.simulationPaused) this.toggleSimulation();
    if (this.workshop.intro === 'again') {
      this.dismissIntro();
      return;
    }
    this.introMarbleId = marble.id;
    this.introTrialUntil = performance.now() + 7200;
  }

  dismissIntro() {
    if (!this.workshop.intro) return;
    this.workshop.intro = undefined;
    this.introMarbleId = 0;
    this.requestSave();
  }

  // ---------------- mode / selection ----------------

  setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.armedDefId = '';
    this.armedSticky = false;
    this.selectedPieceId = 0;
    this.clearPreview();
    this.dropPreview = null;
    this.audio.ui();
    this.ui?.refreshTray();
    this.ui?.refreshMode();
    this.ui?.updateSelection();
    document.body.classList.remove('armed');
  }

  armPiece(defId: string, sticky = false) {
    if (!PIECE_BY_ID.has(defId)) return;
    if (this.armedDefId === defId) {
      if (sticky && !this.armedSticky) {
        this.armedSticky = true;
        this.ui?.refreshTray();
        this.audio.ui();
      } else {
        this.disarmPiece();
      }
      return;
    }
    this.armedDefId = defId;
    this.testDropArmed = false;
    this.armedSticky = sticky;
    this.selectedPieceId = 0;
    this.mode = 'build';
    this.clearPreview();
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
    this.clearPreview();
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

  toggleTestDrop() {
    this.testDropArmed = !this.testDropArmed;
    this.clearPreview();
    this.dropPreview = null;
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
    if (!PIECE_BY_ID.has(defId)) return null;
    if (this.pieces.length >= 2000) {
      this.audio.error();
      this.ui?.toast('info');
      return null;
    }
    const p = makePiece(this.nextId++, defId, x, y, rot);
    if (getPieceDef(defId).tintable) p.color = Math.floor(Math.random() * COLORS.length);
    const snap = commit ? findSnap(p, this.pieces, this.camera.zoom) : null;
    if (snap) {
      p.x = snap.x;
      p.y = snap.y;
    }
    return this.insertPiece(p, snap, commit);
  }

  previewPiece(defId: string, x: number, y: number) {
    const preview = this.ghost?.defId === defId ? this.ghost : makePiece(0, defId, x, y);
    this.positionPiece(preview, x, y);
    this.ghost = preview;
  }

  placePreview(): Piece | null {
    if (!this.ghost) return null;
    if (this.pieces.length >= 2000) {
      this.audio.error();
      this.ui?.toast('info');
      return null;
    }
    const p = { ...this.ghost, id: this.nextId++, bornAt: performance.now() };
    if (getPieceDef(p.defId).tintable) p.color = Math.floor(Math.random() * COLORS.length);
    return this.insertPiece(p, this.snap, true);
  }

  clearPreview() {
    this.ghost = null;
    this.snap = null;
  }

  private insertPiece(p: Piece, snap: Snap | null, commit: boolean): Piece {
    this.pieces.push(p);
    this.bumpPieces();
    this.rebuildPhysics();
    this.wakeMarbles();
    if (commit) {
      this.history.push({ type: 'add', piece: p });
      this.history = this.history.slice(-60);
      this.redoStack.length = 0;
      this.dirty = true;
      this.requestSave();
      if (snap) this.confirmSnap(snap);
      else this.audio.impact('brick', 300, this.panForX(p.x));
    }
    this.selectPiece(p.id);
    this.requestHud();
    return p;
  }

  removePiece(id: number) {
    const i = this.pieces.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.pieces.splice(i, 1);
    this.bumpPieces();
    this.history.push({ type: 'remove', piece: p });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.selectedPieceId = 0;
    this.rebuildPhysics();
    this.wakeMarbles();
    this.audio.ui();
    this.spawnBurst(p.x, p.y, PALETTE.muted, 5, 0);
    this.dirty = true;
    this.requestSave();
    this.ui?.updateSelection();
    this.requestHud();
  }

  beginMove(p: Piece) {
    this.moveOrigin = { id: p.id, x: p.x, y: p.y };
    this.snap = null;
  }

  movePieceTo(p: Piece, x: number, y: number, precise: boolean) {
    if (this.moveOrigin?.id !== p.id) return;
    const fromX = p.x;
    const fromY = p.y;
    if (precise) {
      this.snap = null;
      p.x = x;
      p.y = y;
    } else {
      this.positionPiece(p, x, y);
    }
    if (p.x !== fromX || p.y !== fromY) this.positionsChanged();
  }

  private positionPiece(p: Piece, x: number, y: number) {
    p.x = x;
    p.y = y;
    const previous = this.snap?.key;
    this.snap = findSnap(p, this.pieces, this.camera.zoom, previous);
    p.x = this.snap?.x ?? Math.round(x / 20) * 20;
    p.y = this.snap?.y ?? Math.round(y / 20) * 20;
    const now = performance.now();
    if (this.snap && this.snap.key !== previous && now - this.lastSnapAt > 120) {
      this.lastSnapAt = now;
      this.audio.clack(this.panForX(this.snap.jointX), false);
    }
  }

  private confirmSnap(snap: Snap) {
    this.snapRipple = { x: snap.jointX, y: snap.jointY, at: performance.now() };
    this.audio.clack(this.panForX(snap.jointX));
    if (this.settings.haptics) vibrate(12);
  }

  cancelMove() {
    if (!this.moveOrigin) return;
    const origin = this.moveOrigin;
    this.moveOrigin = null;
    this.snap = null;
    const p = this.pieceById.get(origin.id);
    if (!p) return;
    p.x = origin.x;
    p.y = origin.y;
    this.positionsChanged();
  }

  endMove() {
    const origin = this.moveOrigin;
    this.moveOrigin = null;
    const snap = this.snap;
    this.snap = null;
    if (!origin) return;
    const p = this.pieceById.get(origin.id);
    if (!p || (p.x === origin.x && p.y === origin.y)) return;
    if (snap) this.confirmSnap(snap);
    this.remember({ type: 'move', id: p.id, from: origin, to: { x: p.x, y: p.y } });
  }

  nudgeSelection(x: number, y: number) {
    const p = this.selectedPiece;
    if (!p || this.moveOrigin) return;
    const from = { x: p.x, y: p.y };
    p.x += x * 4 / this.camera.zoom;
    p.y += y * 4 / (this.camera.zoom * CAMERA_TILT);
    this.positionsChanged();
    this.remember({ type: 'move', id: p.id, from, to: { x: p.x, y: p.y } });
  }

  private positionsChanged() {
    this.physicsDirty = true;
    this.bumpPieces();
    this.wakeMarbles();
  }

  private remember(edit: History) {
    if (this.workshop.intro === 'edit' && (edit.type === 'move' || edit.type === 'rotate') &&
        this.pieceById.get(edit.id)?.defId === 'sTrack') {
      this.workshop.intro = 'again';
    }
    this.history.push(edit);
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.requestSave();
    this.requestHud();
  }

  cycleTempo(piece: Piece) {
    const from = piece.variant;
    piece.variant = (from + 1) % METER_INTERVALS.length;
    this.physicsDirty = true;
    this.remember({ type: 'tempo', id: piece.id, from, to: piece.variant });
    this.audio.ui();
  }

  tuneBar(piece: Piece, bar: number, pitch: number) {
    const from = xyloNotes(piece.notes);
    if (from[bar] === pitch) return;
    piece.notes = from.slice();
    piece.notes[bar] = pitch;
    this.physicsDirty = true;
    this.remember({ type: 'notes', id: piece.id, from, to: piece.notes });
    this.audio.playChime(pitch, 315, this.panForX(piece.x));
  }

  setPieceRot(p: Piece, rot: number, commit = false, from = 0) {
    if (p.rot !== rot) {
      p.rot = rot;
      this.physicsDirty = true;
      this.wakeMarbles();
    }
    if (commit && Math.abs(rot - from) > 0.001) {
      this.remember({ type: 'rotate', id: p.id, from, to: rot });
    }
  }

  setPieceLen(p: Piece, len: number, commit = false, from = 0) {
    p.len = len;
    this.bumpPieces();
    this.rebuildPhysics();
    this.wakeMarbles();
    if (commit && Math.abs(len - from) > 0.001) {
      this.history.push({ type: 'size', id: p.id, from, to: len });
      this.history = this.history.slice(-60);
      this.redoStack.length = 0;
      this.requestSave();
      this.requestHud();
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
  private updateBalances(dt: number) {
    let moved = false;
    for (const p of this.balances) {
      const c = Math.cos(-p.rot);
      const s = Math.sin(-p.rot);
      let torque = 0;
      for (const m of this.marbles) {
        if (!m.alive || m.bubbled || m.ridePiece || m.fanRide) continue;
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
    if (moved) this.physics.syncBalances(this.balances);
  }

  togglePower(id: number) {
    const p = this.pieces.find((x) => x.id === id);
    if (!p) return;
    const pan = this.panForX(p.x);
    if (p.defId === 'electromagnet') {
      p.polarity = (p.polarity ?? 1) > 0 ? -1 : 1;
      this.rebuildPhysics();
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
    this.requestHud();
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
      ...savedPiece(p),
      id: this.nextId++,
      x: p.x + dx,
      y: p.y + dy,
      bornAt: performance.now()
    };
    const snap = findSnap(clone, this.pieces, this.camera.zoom);
    if (snap) {
      clone.x = snap.x;
      clone.y = snap.y;
    }
    return this.insertPiece(clone, snap, true);
  }

  clearCanvas() {
    if (this.pieces.length === 0 && this.marbles.length === 0) return;
    this.cancelMove();
    if (this.pieces.length) {
      this.captureWorkshop();
      const backup = this.makeWorkshop(`${this.workshop.name.slice(0, 30)} · copia`, [], this.activeWorld);
      backup.pieces = this.workshop.pieces;
      backup.camera = { ...this.camera };
      this.workshops.push(backup);
    }
    this.dismissIntro();
    this.history.push({ type: 'clear', pieces: this.pieces });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.pieces = [];
    this.bumpPieces();
    this.marbles = [];
    this.particles = [];
    this.selectedPieceId = 0;
    this.testDropArmed = false;
    this.armedDefId = '';
    this.armedSticky = false;
    this.clearPreview();
    this.snapRipple = null;
    this.dropPreview = null;
    this.timeScale = 1;
    this.slowUntil = 0;
    document.body.classList.remove('armed');
    this.rebuildPhysics();
    this.physics.clearDisabled();
    this.audio.impact('brick', 300, 0);
    this.spawnBurst(this.camera.x, this.camera.y, PALETTE.muted, 12, 0);
    this.dirty = true;
    this.save();
    this.ui?.refreshAll();
    this.ui?.toast('trash');
  }

  private activateWorkshop(workshop: Workshop) {
    this.workshop = workshop;
    this.pieces = workshop.pieces.map(savedPiece);
    this.camera = { ...workshop.camera };
    this.nextId = Math.max(0, ...this.pieces.map((p) => p.id)) + 1;
    this.introMarbleId = 0;
    this.moveOrigin = null;
    this.testDropArmed = false;
    this.simulationPaused = false;
    this.marbles = [];
    this.particles = [];
    this.history = [];
    this.redoStack = [];
    this.selectedPieceId = 0;
    this.armedDefId = '';
    this.armedSticky = false;
    this.clearPreview();
    this.snapRipple = null;
    this.dropPreview = null;
    this.timeScale = 1;
    this.slowUntil = 0;
    this.mode = 'build';
    document.body.classList.remove('armed');
    this.physics = new PhysicsWorld();
    this.cooldowns.clear();
    this.bumpPieces();
    this.rebuildPhysics();
  }

  newWorkshop(name = 'Nuevo taller', pieces: StructurePiece[] = [], guided = false) {
    this.cancelMove();
    this.captureWorkshop();
    const workshop = this.makeWorkshop(name, pieces, this.activeWorld);
    if (guided) workshop.intro = 'drop';
    this.workshops.push(workshop);
    this.activateWorkshop(workshop);
    this.recenter();
    this.requestSave();
    this.save();
    this.ui?.refreshAll();
  }

  openWorkshop(id: string) {
    const workshop = this.workshops.find((item) => item.id === id);
    if (!workshop || this.workshop === workshop) return;
    this.cancelMove();
    this.captureWorkshop();
    this.activateWorkshop(workshop);
    this.requestSave();
    this.save();
    this.ui?.refreshAll();
  }

  renameWorkshop(id: string, value: string) {
    const workshop = this.workshops.find((item) => item.id === id);
    const name = value.trim().slice(0, 48);
    if (!workshop || !name || workshop.name === name) return;
    workshop.name = name;
    workshop.updatedAt = Date.now();
    this.requestSave();
    this.save();
  }

  deleteWorkshop(id: string) {
    this.workshops = this.workshops.filter((workshop) => workshop.id !== id);
    if (this.workshop.id === id) {
      if (!this.workshops.length) this.workshops.push(this.makeWorkshop('Nuevo taller', [], this.activeWorld));
      this.activateWorkshop(this.workshops[0]);
    }
    this.requestSave();
    this.save();
    this.ui?.refreshAll();
  }

  private makeWorkshop(name: string, layout: StructurePiece[], theme: number): Workshop {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const pieces = layout.map((sp, i) => ({
      ...makePiece(i + 1, sp.defId, sp.x, sp.y, sp.rot, sp.len),
      color: sp.color ?? getPieceDef(sp.defId).defaultColor,
      variant: sp.variant ?? (sp.defId === 'meter' ? 1 : 0), polarity: sp.polarity,
      powered: sp.defId === 'marbleFactory' ? sp.powered !== false : undefined, notes: sp.notes
    }));
    return { id, name, pieces, updatedAt: Date.now(), theme, camera: newCamera() };
  }

  undo() {
    this.cancelMove();
    const h = this.history.pop();
    if (!h) return;
    this.applyHistory(h, true);
    this.redoStack.push(h);
    this.dirty = true;
    this.requestSave();
    this.audio.ui();
    this.requestHud();
  }

  redo() {
    this.cancelMove();
    const h = this.redoStack.pop();
    if (!h) return;
    this.applyHistory(h, false);
    this.history.push(h);
    this.dirty = true;
    this.requestSave();
    this.audio.ui();
    this.requestHud();
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
      const p = this.pieceById.get(h.id);
      const position = undo ? h.from : h.to;
      if (p) {
        p.x = position.x;
        p.y = position.y;
      }
    } else if (h.type === 'rotate') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.rot = undo ? h.from : h.to;
    } else if (h.type === 'size') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.len = undo ? h.from : h.to;
    } else if (h.type === 'tempo') {
      const p = this.pieceById.get(h.id);
      if (p) p.variant = undo ? h.from : h.to;
    } else if (h.type === 'notes') {
      const p = this.pieceById.get(h.id);
      if (p) p.notes = undo ? h.from : h.to;
    } else if (h.type === 'clear') {
      this.pieces = undo ? h.pieces : [];
    }
    this.selectedPieceId = 0;
    this.bumpPieces();
    this.rebuildPhysics();
    this.wakeMarbles();
    this.ui?.updateSelection();
    this.ui?.refreshTray();
  }

  // ---------------- marbles ----------------

  spawnMarble(x: number, y: number, typeId = this.selectedMarble) {
    const type = this.marbleType(typeId);
    if (!type) return null;
    if (this.marbles.length >= 200) {
      const old = this.marbles.shift();
      if (old) {
        old.alive = false;
        this.spawnBurst(old.x, old.y, PALETTE.muted, 3, 0);
      }
    }
    const m = createMarble(this.nextMarbleId++, type, x, y, 0, nowMs());
    this.marbles.push(m);
    if (typeId !== this.selectedMarble) {
      this.selectedMarble = typeId;
      this.ui?.refreshTray();
      this.requestSave();
    }
    this.spawnBurst(x, y, type.color, 4, 0);
    return m;
  }

  private marbleType(id: string) {
    if (id === 'surprise') return SURPRISE_MARBLES[Math.floor(Math.random() * SURPRISE_MARBLES.length)];
    return MARBLE_BY_ID.get(id);
  }


  private cleanupMarbles() {
    const viewBottom = this.camera.y + this.viewH / (2 * this.camera.zoom * CAMERA_TILT);
    const floor = Math.max(this.sceneBottom, viewBottom) + 1450;
    let sleeping = 0;
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      const out = Math.abs(m.x) > 90000 || Math.abs(m.y) > 90000 || (m.y > floor && m.vy > 0);
      if (!m.alive || out || (!m.awake && ++sleeping > 80)) {
        m.alive = false;
        this.marbles.splice(i, 1);
      }
    }
  }

  // ---------------- piece feedback ----------------

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
        if (this.introMarbleId === e.marbleId && this.workshop.intro === 'drop') {
          this.workshop.intro = 'edit';
          this.introMarbleId = 0;
          this.requestSave();
        }
        if (!this.allow(`chime:${e.pieceId}:${e.note}`, 88, now)) continue;
        const p = this.pieceById.get(e.pieceId);
        if (p) {
          p.flash = now;
          p.flashNote = e.note;
        }
        this.audio.playChime(e.pitch ?? e.note, e.impact, pan);
        this.spawnBurst(e.x, e.y, NOTE_COLORS[e.pitch ?? e.note] ?? PALETTE.yellow, 5, 1);
      } else if (e.type === 'hourglass') {
        const p = this.pieceById.get(e.pieceId);
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
          this.physics.setPieceDisabled(p.id, respawn);
          if (this.selectedPieceId === p.id) {
            this.selectedPieceId = 0;
            this.ui?.updateSelection();
          }
        }
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.yellow, 18, 2);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 12, 1);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 8, 0);
        this.ui?.flash(0.18);
      } else if (e.type === 'bumper') {
        if (!this.allow(`bump:${e.marbleId}:${e.pieceId}`, 240, now)) continue;
        const p = this.pieceById.get(e.pieceId);
        if (p) p.flash = now;
        this.audio.bumper(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 6, 1);
      } else if (e.type === 'cannon') {
        this.audio.cannon(pan);
        this.spawnBurst(e.x, e.y, PALETTE.purple, 5, 0);
        const m = this.marbles.find((x) => x.id === e.marbleId);
        if (m && m.alive && m.typeId === 'plasma') this.splitPlasma(m, e, now);
      } else if (e.type === 'boost') {
        if (!this.allow(`boost:${e.marbleId}:${e.pieceId}`, 500, now)) continue;
        this.audio.boost(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 3, 0);
      } else if (e.type === 'fan') {
        const p = this.pieceById.get(e.pieceId);
        if (p) p.flash = now;
        if (this.allow(`fan:${e.pieceId}`, 150, now)) this.audio.air(pan);
      } else if (e.type === 'channel') {
        const p = this.pieceById.get(e.pieceId);
        if (p) p.flash = now;
        if (this.allow(`channel:${e.pieceId}`, 90, now)) this.audio.clack(pan, false);
      } else if (e.type === 'contact') {
        if (Math.abs(e.x - this.camera.x) > this.viewW * 0.6 / this.camera.zoom) continue;
        if (Math.abs(e.y - this.camera.y) > this.viewH * 0.6 / (this.camera.zoom * CAMERA_TILT)) continue;
        if (this.allow(`contact:${e.pieceId}`, 100, now)) this.audio.impact(e.material ?? 'brick', e.impact * 0.45, pan);
      } else if (e.type === 'spiral') {
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 8, 1);
      } else if (e.type === 'bubble') {
        this.audio.bubble(pan);
        this.spawnBurst(e.x, e.y, '#8FD3EE', 12, 1);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 6, 0);
        this.bubbleBlueMarbles(e.marbleId);
      } else if (e.type === 'pop') {
        this.audio.pop(pan);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 8, 0);
        this.spawnBurst(e.x, e.y, '#8FD3EE', 7, 1);
      } else if (e.type === 'portal') {
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.purple, 10, 1);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 6, 0);
      } else if (e.type === 'goal') {
        this.audio.goal(pan);
        const p = this.pieceById.get(e.pieceId);
        if (p) p.anim = now;
        this.spawnBurst(e.x, e.y, '#FFDCA0', 8, 1);
      } else if (e.type === 'star') {
        this.audio.star(pan);
        this.spawnBurst(e.x, e.y, PALETTE.yellow, 12, 1);
        const p = this.pieceById.get(e.pieceId);
        if (p) p.disabledUntil = now + 5000;
      } else if (e.type === 'marble') {
        if (!this.allow(`marble:${e.marbleId}`, 100, now)) continue;
        this.audio.impact('brick', e.impact * 0.55, pan);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 2, 0);
      } else if (e.type === 'rainbow') {
        this.spawnFireworks(e.x, e.y, 3);
        this.audio.firework(pan);
        this.ui?.flash(0.1);
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
      0,
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
      m.fanRide = undefined;
      m.channelRide = undefined;
      m.rideT = 0;
      m.rideScale = 1;
      m.rideDepth = 0;
      m.awake = true;
      this.spawnBurst(m.x, m.y, '#8FD3EE', 10, 1);
      this.spawnBurst(m.x, m.y, PALETTE.paper3, 4, 0);
    }
  }

  private updateTrails(dt: number) {
    if (this.settings.quality === 'low' || prefersReducedMotion()) return;
    for (const m of this.marbles) {
      if (!m.awake || m.fanRide || m.channelRide || m.vx * m.vx + m.vy * m.vy < 1600 || !MARBLE_BY_ID.get(m.typeId)?.premium) continue;
      m.trailAcc += dt;
      if (m.trailAcc < 0.045) continue;
      m.trailAcc = 0;
      m.trail.unshift(m.x, m.y);
      if (m.trail.length > 14) m.trail.length = 14;
    }
  }

  /** Las fábricas de canicas encendidas emiten una canica por segundo. */
  private updateFactories(now: number) {
    for (const p of this.factories) {
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
    const type = this.marbleType(this.selectedMarble) ?? MARBLE_TYPES[0];
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const x = p.x + FACTORY_OUTLET.x * c - FACTORY_OUTLET.y * s;
    const y = p.y + FACTORY_OUTLET.x * s + FACTORY_OUTLET.y * c;
    const m = createMarble(this.nextMarbleId++, type, x, y, 0, now);
    const spread = (Math.random() - 0.5) * 24;
    m.vx = spread * c - 30 * s;
    m.vy = spread * s + 30 * c;
    m.auto = true;
    this.marbles.push(m);
    p.anim = now;
    this.spawnBurst(x, y, type.color, 3, 0);
    this.audio.impact('metal', 300, this.panForX(x));
  }

  private updateBubbles(now: number) {
    for (const p of this.fragileRamps) {
      if (p.disabledUntil && p.disabledUntil > now) {
        p.charge = 0;
        p.anim = undefined;
        continue;
      }
      let weight = 0;
      const half = pieceLength(p) / 2;
      const c = Math.cos(-p.rot);
      const s = Math.sin(-p.rot);
      for (const m of this.marbles) {
        if (!m.alive || m.bubbled || m.fanRide || m.ridePiece || !m.contact) continue;
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        const lx = dx * c - dy * s;
        const ly = dx * s + dy * c;
        if (Math.abs(lx) < half + 8 && Math.abs(ly) < m.r + 10) weight++;
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
    this.ui?.flash(0.12);
  }

  // ---------------- effects ----------------

  spawnBurst(x: number, y: number, color: string, count: number, kind: number, scale = 1) {
    const reduce = prefersReducedMotion();
    if (Math.abs(x - this.camera.x) > this.viewW / (2 * this.camera.zoom) + 160 ||
        Math.abs(y - this.camera.y) > this.viewH / (2 * this.camera.zoom * CAMERA_TILT) + 160) return;
    const n = reduce || this.settings.quality === 'low' ? Math.min(4, count) : count;
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
    // trim trails of sleeping marbles
    for (const m of this.marbles) {
      if (!m.awake && m.trail.length > 0 && now - m.bornAt > 2000) {
        m.trail.length = 0;
      }
    }
  }

  private maybeSave(now: number) {
    if (!this.dirty) return;
    if (now - this.lastSave < 2500) return;
    if (this.saveIdlePending) return;
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (idle) {
      this.saveIdlePending = true;
      idle(
        () => {
          this.saveIdlePending = false;
          if (this.dirty) this.save();
        },
        { timeout: 1500 }
      );
      return;
    }
    this.save();
  }

  requestSave() {
    this.dirty = true;
  }

  // ---------------- settings ----------------

  applySettings() {
    this.audio.setLevel(this.settings.sound);
  }

  cycleSound() {
    this.settings.sound = this.settings.sound === 0 ? 2 : this.settings.sound === 2 ? 1 : 0;
    this.applySettings();
    this.requestSave();
    if (this.settings.sound) {
      void this.audio.unlock();
      this.audio.ui();
    }
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
    if (i === this.activeWorld || i < 0 || i >= WORLD_THEMES.length) return;
    this.workshop.theme = i;
    this.dirty = true;
    this.save();
    this.ui?.refreshSettings();
  }

  // ---------------- persistence ----------------

  private load() {
    let data: ReturnType<typeof findAlbum> = null;
    let needsSave = true;
    try {
      data = findAlbum(localStorage);
      needsSave = !localStorage.getItem(ALBUM_KEY);
    } catch {
      /* El taller sigue siendo jugable si el navegador bloquea el almacenamiento. */
    }
    this.settings = data?.settings ?? { ...DEFAULT_SETTINGS };
    this.selectedMarble = data?.selectedMarble ?? 'crystal';
    this.applySettings();
    if (data?.workshops.length) {
      this.workshops = data.workshops;
      this.activateWorkshop(this.workshops.find((item) => item.id === data.activeId) ?? this.workshops[0]);
    } else {
      const first = this.makeWorkshop('Mi taller', [], NORMAL_THEME);
      this.workshops = [first];
      this.activateWorkshop(first);
      this.fresh = true;
    }
    if (needsSave || this.fresh) this.requestSave();
  }

  private captureWorkshop() {
    const origin = this.moveOrigin;
    this.workshop.pieces = this.pieces.map((p) => savedPiece(p.id === origin?.id ? { ...p, x: origin.x, y: origin.y } : p));
    this.workshop.camera = { ...this.camera };
    if (this.dirty) this.workshop.updatedAt = Date.now();
  }

  save() {
    if (!this.dirty) return;
    this.captureWorkshop();
    this.lastSave = performance.now();
    try {
      localStorage.setItem(ALBUM_KEY, JSON.stringify({
        v: 2, activeId: this.workshop.id, workshops: this.workshops, settings: this.settings, selectedMarble: this.selectedMarble
      }));
      this.dirty = false;
    } catch {
      this.ui?.toast('info', 'No se pudo guardar el álbum');
    }
  }
}
