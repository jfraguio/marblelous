import type {
  Camera,
  ChallengeDef,
  DropSummary,
  Marble,
  Mode,
  Particle,
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
  getPieceDef,
  makePiece,
  pieceContains
} from './pieces';
import type { UI } from './ui';
import { clamp, nowMs, prefersReducedMotion, vibrate } from './util';

const SAVE_KEY = 'marblelous.save.v1';
const BACKUP_KEY = 'marblelous.backup.v1';
const FIXED = 1 / 120;

export const CHALLENGES: ChallengeDef[] = [
  { id: 'firstGoal', target: 1, reward: 300, preview: 'goal', previewType: 'piece', label: 'Primer viaje', perDrop: false },
  { id: 'notes5', target: 5, reward: 500, preview: 'xylo5', previewType: 'piece', label: 'Escalera musical', perDrop: true },
  { id: 'loop1', target: 1, reward: 500, preview: 'loop', previewType: 'piece', label: 'El bucle', perDrop: true },
  { id: 'air2', target: 2000, reward: 400, preview: 'air', previewType: 'icon', icon: 'air', label: 'Vuelo', perDrop: true },
  { id: 'tramp8', target: 8, reward: 400, preview: 'trampoline', previewType: 'piece', label: 'Cama elástica', perDrop: true },
  { id: 'build50', target: 50, reward: 300, preview: 'brick4', previewType: 'piece', label: 'Constructor', perDrop: false },
  { id: 'marbles20', target: 20, reward: 450, preview: 'crystal', previewType: 'marble', label: 'Lluvia', perDrop: true },
  { id: 'goals10', target: 10, reward: 600, preview: 'goal', previewType: 'piece', label: 'Diana', perDrop: false },
  { id: 'combo4', target: 4, reward: 600, preview: 'spark', previewType: 'icon', icon: 'spark', label: 'Combo', perDrop: true },
  { id: 'speed2500', target: 2500, reward: 500, preview: 'booster', previewType: 'piece', label: 'Cohete', perDrop: true },
  { id: 'bricks25', target: 25, reward: 350, preview: 'brick2', previewType: 'piece', label: 'Torre', perDrop: false },
  { id: 'lifetime10k', target: 10000, reward: 750, preview: 'spark', previewType: 'icon', icon: 'spark', label: 'Maratón', perDrop: false }
];

interface DropStats {
  sparks: number;
  notes: Set<number>;
  loops: number;
  goals: number;
  tramps: number;
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
  | { type: 'move'; id: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'rotate'; id: number; from: number; to: number }
  | { type: 'size'; id: number; from: number; to: number }
  | { type: 'color'; id: number; from: number; to: number }
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
  selectedPieceId = 0;
  selectedMarble = 'crystal';
  color = 0;
  ghost: Ghost | null = null;
  dropPreview: { x: number; y: number } | null = null;
  paused = false;
  overlayOpen = false;
  hidden = false;
  private overlayPaused = false;

  currency = 0;
  lifetime = 0;
  owned = new Set<string>(STARTING_OWNED);
  worlds: WorldData[] = [];
  activeWorld = 0;
  records: Records = {
    combo: 1,
    speed: 0,
    airTime: 0,
    marbles: 0,
    bestDrop: 0,
    loops: 0,
    goals: 0
  };
  settings: Settings = {
    sound: 2,
    quality: 'auto',
    leftHanded: false,
    reduceMotion: false,
    haptics: false,
    tutorialSeen: false
  };
  challenges: Record<string, number> = {};
  tutorialStep = 0;

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
  private viewInitialized = false;
  fresh = false;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.canvas = canvas;
    this.audio = audio;
    this.load();
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
      loops: 0,
      goals: 0,
      tramps: 0,
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
      this.accumulator += raw;
      let steps = 0;
      while (this.accumulator >= FIXED && steps < 12) {
        this.physics.clearEvents();
        this.physics.update(this.marbles, FIXED, now);
        this.processEvents(now);
        this.cleanupMarbles();
        this.accumulator -= FIXED;
        steps++;
      }
      if (steps >= 12) this.accumulator = 0;
      this.updateEffects(raw, now);
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
      this.audio.updateRolling(0, 0);
    } else {
      this.accumulator = 0;
      this.last = performance.now();
    }
    this.overlayPaused = open;
  }

  setPaused(p: boolean) {
    this.paused = p;
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
      y: (sy - this.viewH / 2) / this.camera.zoom + this.camera.y
    };
  }

  worldToScreen(wx: number, wy: number) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.viewW / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.viewH / 2
    };
  }

  panByScreen(dx: number, dy: number) {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
  }

  zoomAtScreen(sx: number, sy: number, zoom: number) {
    const nz = clamp(zoom, 0.3, 2.5);
    const old = this.camera.zoom;
    if (Math.abs(nz - old) < 0.0001) return;
    const px = (sx - this.viewW / 2) / old;
    const py = (sy - this.viewH / 2) / old;
    this.camera.x += px - (sx - this.viewW / 2) / nz;
    this.camera.y += py - (sy - this.viewH / 2) / nz;
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
    const zoom = clamp(Math.min((this.viewW - 120) / w, (this.viewH - 190) / h), 0.3, 1.2);
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
    this.selectedPieceId = 0;
    this.ghost = null;
    this.dropPreview = null;
    this.audio.ui();
    if (mode === 'play' && this.tutorialStep < 3) this.advanceTutorial(3);
    this.ui?.refreshTray();
    this.ui?.refreshMode();
    this.ui?.updateSelection();
    document.body.classList.remove('armed');
  }

  armPiece(defId: string) {
    if (!this.owned.has(defId)) return;
    if (this.armedDefId === defId) {
      this.disarmPiece();
      return;
    }
    this.armedDefId = defId;
    this.selectedPieceId = 0;
    this.mode = 'build';
    this.ghost = null;
    this.dropPreview = null;
    document.body.classList.add('armed');
    this.audio.ui();
    if (this.tutorialStep === 0) this.advanceTutorial(1);
    this.ui?.refreshTray();
    this.ui?.refreshMode();
    this.ui?.updateSelection();
  }

  disarmPiece() {
    if (!this.armedDefId) return;
    this.armedDefId = '';
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
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      if (pieceContains(this.pieces[i], wx, wy)) return this.pieces[i];
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
    if (getPieceDef(defId).tintable) p.color = this.color;
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
    this.updateBuildChallenges();
    this.ui?.refreshHud();
    if (this.tutorialStep === 1) this.advanceTutorial(2);
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
    this.updateBuildChallenges();
    this.ui?.updateSelection();
    this.ui?.refreshHud();
  }

  beginMove(p: Piece) {
    this.selectPiece(p.id);
  }

  movePieceTo(p: Piece, x: number, y: number) {
    p.x = Math.round(x / 20) * 20;
    p.y = Math.round(y / 20) * 20;
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
  }

  endMove(p: Piece, fromX: number, fromY: number) {
    if (Math.abs(p.x - fromX) < 0.1 && Math.abs(p.y - fromY) < 0.1) return;
    this.history.push({ type: 'move', id: p.id, fromX, fromY, toX: p.x, toY: p.y });
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

  setPieceColor(p: Piece, color: number, commit = false, from = 0) {
    p.color = color;
    this.color = color;
    if (commit && color !== from) {
      this.history.push({ type: 'color', id: p.id, from, to: color });
      this.history = this.history.slice(-60);
      this.redoStack.length = 0;
      this.dirty = true;
      this.requestSave();
    }
    this.ui?.updateSelection();
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

  duplicatePiece(p: Piece): Piece | null {
    if (this.pieces.length >= 2000) {
      this.audio.error();
      this.ui?.toast('info');
      return null;
    }
    const size = p.defId === 'ramp' ? p.len : getPieceDef(p.defId).w;
    const off = Math.max(66, size * 0.5 + 44);
    const dx = Math.cos(p.rot) * off;
    const dy = Math.sin(p.rot) * off;
    const clone: Piece = {
      ...p,
      id: this.nextId++,
      x: p.x + dx,
      y: p.y + dy,
      bornAt: performance.now(),
      flash: undefined,
      anim: undefined,
      disabledUntil: undefined,
      charge: undefined
    };
    this.pieces.push(clone);
    this.physics.rebuild(this.pieces);
    this.history.push({ type: 'add', piece: clone });
    this.history = this.history.slice(-60);
    this.redoStack.length = 0;
    this.selectPiece(clone.id);
    this.audio.impact('brick', 240, this.panForX(clone.x));
    this.spawnBurst(clone.x, clone.y, PALETTE.yellow, 6, 0);
    this.dirty = true;
    this.requestSave();
    this.updateBuildChallenges();
    this.ui?.refreshHud();
    return clone;
  }

  clearCanvas() {
    if (this.pieces.length === 0 && this.marbles.length === 0) return;
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
    document.body.classList.remove('armed');
    this.physics.rebuild(this.pieces);
    this.physics.clearDisabled();
    this.audio.impact('brick', 300, 0);
    this.spawnBurst(this.camera.x, this.camera.y, PALETTE.muted, 12, 0);
    this.dirty = true;
    this.requestSave();
    this.updateBuildChallenges();
    this.ui?.refreshAll();
    this.ui?.toast('trash');
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
      }
    } else if (h.type === 'rotate') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.rot = undo ? h.from : h.to;
    } else if (h.type === 'size') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.len = undo ? h.from : h.to;
    } else if (h.type === 'color') {
      const p = this.pieces.find((x) => x.id === h.id);
      if (p) p.color = undo ? h.from : h.to;
    } else if (h.type === 'clear') {
      this.pieces = undo ? h.pieces : [];
    }
    this.selectedPieceId = 0;
    this.worlds[this.activeWorld].pieces = this.pieces;
    this.physics.rebuild(this.pieces);
    this.wakeMarbles();
    this.updateBuildChallenges();
    this.ui?.updateSelection();
    this.ui?.refreshTray();
  }

  // ---------------- marbles ----------------

  spawnMarble(x: number, y: number, typeId = this.selectedMarble) {
    if (!this.owned.has(typeId)) return null;
    if (this.marbles.length >= 200) {
      const old = this.marbles.shift();
      if (old) {
        old.alive = false;
        this.spawnBurst(old.x, old.y, PALETTE.muted, 3, 0);
      }
    }
    const type = MARBLE_BY_ID.get(typeId) ?? MARBLE_TYPES[0];
    if (!this.dropActive) {
      this.dropActive = true;
      this.dropId++;
      this.dropStats = this.emptyStats();
    }
    const m = createMarble(this.nextMarbleId++, type, x, y, this.dropId, nowMs());
    this.marbles.push(m);
    this.lastSpawn = nowMs();
    if (this.selectedMarble !== typeId) {
      this.selectedMarble = typeId;
      this.ui?.refreshTray();
    }
    this.records.marbles = Math.max(this.records.marbles, this.marbles.length);
    this.updateChallenge('marbles20', this.marbles.length);
    this.dropStats.maxSpeed = Math.max(this.dropStats.maxSpeed, 0);
    this.spawnBurst(x, y, type.color, 4, 0);
    if (this.tutorialStep <= 3) this.advanceTutorial(4);
    this.dirty = true;
    return m;
  }

  clearMarbles() {
    for (const m of this.marbles) m.alive = false;
    this.spawnBurst(this.camera.x, this.camera.y, PALETTE.muted, 12, 0);
    this.audio.ui();
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
        this.updateChallenge('notes5', this.dropStats.notes.size);
        this.score(5, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'trampoline') {
        if (!this.allow(`tramp:${e.marbleId}:${e.pieceId}`, 340, now)) continue;
        const p = this.pieces.find((x) => x.id === e.pieceId);
        if (p) p.anim = now;
        this.audio.trampoline(e.impact, pan);
        this.spawnBurst(e.x, e.y, PALETTE.green, 5, 0);
        this.dropStats.tramps++;
        this.updateChallenge('tramp8', this.dropStats.tramps);
        this.score(8, e.x, e.y, e.marbleId, now);
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
      } else if (e.type === 'boost') {
        if (!this.allow(`boost:${e.marbleId}:${e.pieceId}`, 500, now)) continue;
        this.audio.boost(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 3, 0);
        this.score(2, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'spiral') {
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 8, 1);
      } else if (e.type === 'portal') {
        this.audio.portal(pan);
        this.spawnBurst(e.x, e.y, PALETTE.purple, 10, 1);
        this.spawnBurst(e.x, e.y, PALETTE.teal, 6, 0);
        this.score(5, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'loop') {
        if (!this.allow(`loop:${e.marbleId}:${e.pieceId}`, 2600, now)) continue;
        this.audio.loop(pan);
        this.spawnBurst(e.x, e.y, PALETTE.red, 18, 1);
        this.dropStats.loops++;
        this.records.loops++;
        this.updateChallenge('loop1', this.dropStats.loops);
        this.score(60, e.x, e.y, e.marbleId, now);
        this.ui?.flash(0.16);
      } else if (e.type === 'goal') {
        const m = this.marbles.find((x) => x.id === e.marbleId);
        this.audio.goal(pan);
        const p = this.pieces.find((x) => x.id === e.pieceId);
        if (p) p.anim = now;
        this.spawnConfetti(e.x, e.y - 20);
        this.dropStats.goals++;
        this.records.goals++;
        this.updateChallenge('goals10', this.records.goals);
        this.updateChallenge('firstGoal', this.records.goals);
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
        this.updateChallenge('air2', this.records.airTime);
        if (pts > 0) this.score(pts, e.x, e.y, e.marbleId, now);
      } else if (e.type === 'marble') {
        if (!this.allow(`marble:${e.marbleId}`, 100, now)) continue;
        this.audio.impact('brick', e.impact * 0.55, pan);
        this.spawnBurst(e.x, e.y, PALETTE.paper3, 2, 0);
      }
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
    this.updateChallenge('combo4', this.records.combo);
    this.updateChallenge('lifetime10k', this.lifetime);
    this.spawnPopup(x, y - 14, `+${pts}`);
    this.dirty = true;
    this.ui?.refreshHud();
  }

  private updateRecords(now: number) {
    let max = 0;
    let weightedX = 0;
    let weight = 0;
    let grounded = 0;
    for (const m of this.marbles) {
      if (!m.alive) continue;
      const s = Math.hypot(m.vx, m.vy);
      if (s > max) max = s;
      if (m.contact) {
        weightedX += m.x * Math.max(40, s);
        weight += Math.max(40, s);
        grounded++;
      }
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
      this.updateChallenge('speed2500', max);
      this.dirty = true;
    }
    if (this.dropStats.maxSpeed < max) this.dropStats.maxSpeed = max;
    const pan = weight > 0 ? clamp((weightedX / weight - this.camera.x) / (this.viewW / 2 / this.camera.zoom), -1, 1) : 0;
    this.audio.updateRolling(weight > 0 ? Math.min(0.9, grounded * 0.12 + max / 3500) : 0, pan);
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

  private updateBubbles(now: number) {
    for (const p of this.pieces) {
      if (p.defId !== 'bubble') continue;
      if (p.disabledUntil && p.disabledUntil > now) {
        p.charge = 0;
        continue;
      }
      let count = 0;
      for (const m of this.marbles) {
        if (!m.alive) continue;
        if (Math.abs(m.x - p.x) < 120 && m.y < p.y + 12 && m.y > p.y - 190) count++;
      }
      p.charge = count;
      if (count > 10) this.explodeBubble(p, now);
    }
  }

  private explodeBubble(p: Piece, now: number) {
    p.disabledUntil = now + 6000;
    p.charge = 0;
    this.physics.setPieceDisabled(p.id, now + 6000);
    for (const m of this.marbles) {
      if (!m.alive) continue;
      if (Math.abs(m.x - p.x) < 150 && m.y < p.y + 24 && m.y > p.y - 220) {
        m.vy += 90;
        m.awake = true;
        m.sleepTimer = 0;
      }
    }
    this.audio.bubble(this.panForX(p.x));
    this.spawnBurst(p.x, p.y - 20, '#8FD3EE', 24, 1);
    this.spawnBurst(p.x, p.y - 20, PALETTE.teal, 12, 0);
    this.addBonus(40, p.x, p.y - 20);
    this.ui?.flash(0.14);
  }

  private updateDrop(now: number) {
    if (!this.dropActive) return;
    if (this.marbles.length === 0) {
      if (now - this.lastSpawn > 1400) this.endDrop();
      return;
    }
    let awake = false;
    for (const m of this.marbles) if (m.alive && m.awake) awake = true;
    if (!awake && now - this.lastSpawn > 2200) this.endDrop();
  }

  private endDrop() {
    if (!this.dropActive) return;
    this.dropActive = false;
    const stats = this.dropStats;
    this.records.bestDrop = Math.max(this.records.bestDrop, stats.sparks);
    this.updateChallenge('combo4', stats.maxCombo);
    this.updateChallenge('air2', stats.airTime);
    this.updateChallenge('notes5', stats.notes.size);
    this.updateChallenge('loop1', stats.loops);
    this.updateChallenge('tramp8', stats.tramps);
    if (stats.sparks > 0 || stats.notes.size > 0) {
      const summary: DropSummary = {
        sparks: stats.sparks,
        notes: stats.notes.size,
        loops: stats.loops,
        goals: stats.goals,
        bestCombo: stats.maxCombo
      };
      this.ui?.showSummary(summary);
    }
    this.dirty = true;
    this.requestSave();
  }

  private updateBuildChallenges() {
    this.updateChallenge('build50', this.pieces.length);
    const bricks = this.pieces.filter((p) => p.defId === 'brick2' || p.defId === 'brick4' || p.defId === 'plate4').length;
    this.updateChallenge('bricks25', bricks);
  }

  private updateChallenge(id: string, value: number) {
    const def = CHALLENGES.find((c) => c.id === id);
    if (!def) return;
    const prev = this.challenges[id] ?? 0;
    if (value <= prev) return;
    this.challenges[id] = Math.min(def.target, value);
    if (prev < def.target && value >= def.target) {
      this.challenges[id] = def.target;
      this.currency += def.reward;
      this.lifetime += def.reward;
      this.audio.medal();
      this.ui?.toast('trophy', `+${def.reward}`);
      this.ui?.refreshChallenges();
      this.ui?.refreshHud();
      this.ui?.flash(0.18);
      this.dirty = true;
      this.requestSave();
    } else {
      this.dirty = true;
    }
  }

  // ---------------- effects ----------------

  spawnBurst(x: number, y: number, color: string, count: number, kind: number) {
    const reduce = this.settings.reduceMotion;
    const n = reduce ? Math.min(4, count) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 140;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.45 + Math.random() * 0.45,
        maxLife: 0.9,
        size: 2 + Math.random() * 3,
        color,
        kind,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        alpha: 1
      });
    }
    if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
  }

  spawnConfetti(x: number, y: number) {
    const reduce = this.settings.reduceMotion;
    const n = reduce ? 5 : 20;
    const colors = [PALETTE.red, PALETTE.yellow, PALETTE.teal, PALETTE.green, PALETTE.pink, PALETTE.blue];
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 360,
        vy: -120 - Math.random() * 260,
        life: 1.1 + Math.random() * 0.7,
        maxLife: 1.8,
        size: 3 + Math.random() * 4,
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

  // ---------------- tutorial ----------------

  advanceTutorial(step: number) {
    if (this.settings.tutorialSeen) return;
    if (step > this.tutorialStep) {
      this.tutorialStep = step;
      if (step >= 4) {
        this.tutorialStep = 4;
        this.settings.tutorialSeen = true;
      }
      this.dirty = true;
      this.requestSave();
      this.ui?.updateTutorial();
    }
  }

  skipTutorial() {
    this.tutorialStep = 4;
    this.settings.tutorialSeen = true;
    this.dirty = true;
    this.requestSave();
    this.ui?.updateTutorial();
  }

  restartTutorial() {
    this.tutorialStep = 0;
    this.settings.tutorialSeen = false;
    this.dirty = true;
    this.requestSave();
    this.ui?.updateTutorial();
  }

  // ---------------- settings ----------------

  applySettings() {
    document.body.classList.toggle('lefty', this.settings.leftHanded);
    document.body.classList.toggle('reduce-motion', this.settings.reduceMotion);
    this.audio.setLevel(this.settings.sound);
  }

  setSound(level: 0 | 1 | 2) {
    this.settings.sound = level;
    this.applySettings();
    this.dirty = true;
    this.requestSave();
    this.ui?.refreshSettings();
    this.ui?.refreshSound();
  }

  cycleSound() {
    this.setSound(((this.settings.sound + 1) % 3) as 0 | 1 | 2);
    this.audio.ui();
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

  toggleLefty() {
    this.settings.leftHanded = !this.settings.leftHanded;
    this.applySettings();
    this.dirty = true;
    this.requestSave();
    this.ui?.refreshSettings();
    this.audio.ui();
  }

  toggleReduceMotion() {
    this.settings.reduceMotion = !this.settings.reduceMotion;
    this.applySettings();
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
    this.save();
    this.worlds[this.activeWorld].pieces = this.pieces;
    this.worlds[this.activeWorld].camera = { ...this.camera };
    this.activeWorld = i;
    this.pieces = this.worlds[i].pieces;
    this.camera = this.worlds[i].camera ?? { x: 0, y: 0, zoom: 1 };
    this.records = this.worlds[i].records ?? {
      combo: 1,
      speed: 0,
      airTime: 0,
      marbles: 0,
      bestDrop: 0,
      loops: 0,
      goals: 0
    };
    if (!this.worlds[i].records) this.worlds[i].records = this.records;
    this.marbles = [];
    this.particles = [];
    this.popups = [];
    this.selectedPieceId = 0;
    this.armedDefId = '';
    this.ghost = null;
    this.dropPreview = null;
    this.history.length = 0;
    this.redoStack.length = 0;
    this.physics.clearDisabled();
    this.nextId = Math.max(0, ...this.pieces.map((p) => p.id)) + 1;
    this.physics.rebuild(this.pieces);
    this.dirty = true;
    this.save();
    this.ui?.refreshAll();
    this.audio.ui();
  }

  resetProgress() {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(BACKUP_KEY);
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
    const starter = this.starterPieces();
    const empty = (): WorldData => ({
      pieces: [],
      camera: { x: 0, y: 0, zoom: 1 },
      records: { combo: 1, speed: 0, airTime: 0, marbles: 0, bestDrop: 0, loops: 0, goals: 0 }
    });
    return {
      v: 1,
      updatedAt: Date.now(),
      currency: 0,
      lifetime: 0,
      owned: [...STARTING_OWNED],
      activeWorld: 0,
      worlds: [
        { pieces: starter, camera: { x: 10, y: 30, zoom: 1 }, records: empty().records },
        empty(),
        empty()
      ],
      settings: {
        sound: 2,
        quality: 'auto',
        leftHanded: false,
        reduceMotion: prefersReducedMotion(),
        haptics: false,
        tutorialSeen: false
      },
      challenges: {},
      tutorialStep: 0,
      selectedMarble: 'crystal',
      color: 0
    };
  }

  private starterPieces(): Piece[] {
    return [
      makePiece(1, 'ramp', -140, -70, 0.44, 220),
      makePiece(2, 'xylo3', 80, 20, 0.1),
      makePiece(3, 'goal', 300, 88, 0),
      makePiece(4, 'brick4', 300, 160, 0)
    ];
  }

  private normalize(data: SaveData, fallback: SaveData): SaveData {
    const worlds: WorldData[] = [];
    for (let i = 0; i < 3; i++) {
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
          len: Number(raw.len) || (raw.defId === 'ramp' ? 160 : 0),
          color: Number.isFinite(raw.color) ? raw.color : getPieceDef(raw.defId).defaultColor,
          variant: Number(raw.variant) || 0
        };
        pieces.push(p);
      }
      const rec = { ...fallback.worlds[0].records, ...(w.records ?? {}) };
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
      activeWorld: clamp(Number(data.activeWorld) || 0, 0, 2),
      worlds,
      settings: { ...fallback.settings, ...(data.settings ?? {}) },
      challenges: data.challenges ?? {},
      tutorialStep: clamp(Number(data.tutorialStep) || 0, 0, 4),
      selectedMarble: MARBLE_BY_ID.has(data.selectedMarble) ? data.selectedMarble : 'crystal',
      color: clamp(Number(data.color) || 0, 0, COLORS.length - 1)
    };
  }

  private applySave(data: SaveData) {
    this.currency = data.currency;
    this.lifetime = data.lifetime;
    this.owned = new Set(data.owned);
    for (const id of STARTING_OWNED) this.owned.add(id);
    this.worlds = data.worlds;
    this.activeWorld = data.activeWorld;
    this.pieces = this.worlds[this.activeWorld].pieces;
    this.camera = this.worlds[this.activeWorld].camera;
    this.records = this.worlds[this.activeWorld].records;
    this.settings = data.settings;
    this.challenges = data.challenges;
    this.tutorialStep = data.tutorialStep;
    this.selectedMarble = data.selectedMarble;
    this.color = data.color;
    this.nextId = Math.max(0, ...this.pieces.map((p) => p.id)) + 1;
  }

  save() {
    this.worlds[this.activeWorld].pieces = this.pieces;
    this.worlds[this.activeWorld].camera = { ...this.camera };
    this.worlds[this.activeWorld].records = this.records;
    const data: SaveData = {
      v: 1,
      updatedAt: Date.now(),
      currency: this.currency,
      lifetime: this.lifetime,
      owned: [...this.owned],
      activeWorld: this.activeWorld,
      worlds: this.worlds.map((w) => ({
        pieces: w.pieces.map((p) => ({
          id: p.id,
          defId: p.defId,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          rot: Math.round(p.rot * 1000) / 1000,
          len: p.len,
          color: p.color,
          variant: p.variant
        })),
        camera: { ...w.camera },
        records: { ...w.records }
      })),
      settings: { ...this.settings },
      challenges: { ...this.challenges },
      tutorialStep: this.tutorialStep,
      selectedMarble: this.selectedMarble,
      color: this.color
    };
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
