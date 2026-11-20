import type { Game } from './game';
import type { UI } from './ui';
import { CAMERA_TILT, clamp, isEditableTarget } from './util';

type Screen = { x: number; y: number };

type Single =
  | {
      type: 'drop';
      pointerId: number;
      start: Screen;
      world: Screen;
      moved: boolean;
      rainTimer: number;
      rainInterval: number;
      raining: boolean;
    }
  | {
      type: 'piece';
      pointerId: number;
      pieceId: number;
      start: Screen;
      fromX: number;
      fromY: number;
      moved: boolean;
    }
  | {
      type: 'pan';
      pointerId: number;
      start: Screen;
      camX: number;
      camY: number;
    }
  | {
      type: 'place';
      pointerId: number;
      defId: string;
      start: Screen;
      world: Screen;
    }
  | null;

interface Pinch {
  startDist: number;
  startZoom: number;
  startMid: Screen;
  worldAtMid: Screen;
}

export class Input {
  private game: Game;
  private ui: UI;
  private canvas: HTMLCanvasElement;
  private pointers = new Map<number, Screen>();
  private single: Single = null;
  private pinch: Pinch | null = null;
  private lastTouchAt = 0;

  constructor(canvas: HTMLCanvasElement, game: Game, ui: UI) {
    this.canvas = canvas;
    this.game = game;
    this.ui = ui;
    this.bindCanvas();
    this.bindKeys();
  }

  private bindCanvas() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown, { passive: false });
    c.addEventListener('pointermove', this.onMove, { passive: false });
    c.addEventListener('pointerup', this.onUp, { passive: false });
    c.addEventListener('pointercancel', this.onCancel, { passive: false });
    c.addEventListener('lostpointercapture', (e) => this.onCancel(e as PointerEvent));
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.game.overlayOpen) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0014);
        this.game.zoomAtScreen(e.clientX, e.clientY, this.game.camera.zoom * factor);
        this.game.saveCamera();
        this.lastTouchAt = performance.now();
      },
      { passive: false }
    );
  }

  private unlockAudio() {
    void this.game.audio.unlock();
  }

  private onDown = (e: PointerEvent) => {
    if (this.game.overlayOpen) return;
    if (this.pointers.size >= 2) return;
    e.preventDefault();
    this.unlockAudio();
    this.lastTouchAt = performance.now();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    if (this.pointers.size === 2) {
      this.cancelSingle();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    const world = this.game.screenToWorld(e.clientX, e.clientY);
    if (this.game.mode === 'build' && this.game.armedDefId) {
      this.single = {
        type: 'place',
        pointerId: e.pointerId,
        defId: this.game.armedDefId,
        start: { x: e.clientX, y: e.clientY },
        world
      };
      this.game.ghost = {
        kind: 'piece',
        defId: this.game.armedDefId,
        x: Math.round(world.x / 20) * 20,
        y: Math.round(world.y / 20) * 20,
        rot: 0
      };
      return;
    }
    if (this.game.mode === 'play') {
      const rainTimer = window.setTimeout(() => {
        if (!this.single || this.single.type !== 'drop' || this.single.moved) return;
        this.single.raining = true;
        this.single.rainInterval = window.setInterval(() => {
          if (!this.single || this.single.type !== 'drop') return;
          const w = this.single.world;
          this.game.spawnMarble(w.x, w.y, this.game.selectedMarble);
        }, 120);
      }, 350);
      this.single = {
        type: 'drop',
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        world,
        moved: false,
        rainTimer,
        rainInterval: 0,
        raining: false
      };
      this.game.dropPreview = world;
    } else {
      const p = this.game.getPieceAt(world.x, world.y);
      if (p) {
        this.game.selectPiece(p.id);
        this.single = {
          type: 'piece',
          pointerId: e.pointerId,
          pieceId: p.id,
          start: { x: e.clientX, y: e.clientY },
          fromX: p.x,
          fromY: p.y,
          moved: false
        };
      } else {
        this.game.deselect();
        this.game.dropPreview = null;
        this.single = {
          type: 'pan',
          pointerId: e.pointerId,
          start: { x: e.clientX, y: e.clientY },
          camX: this.game.camera.x,
          camY: this.game.camera.y
        };
      }
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }
    const s = this.single;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.start.x;
    const dy = e.clientY - s.start.y;
    if (s.type === 'drop') {
      if (!s.moved && Math.hypot(dx, dy) > 10) {
        s.moved = true;
        clearTimeout(s.rainTimer);
        clearInterval(s.rainInterval);
        s.raining = false;
        this.game.dropPreview = null;
        this.single = {
          type: 'pan',
          pointerId: s.pointerId,
          start: s.start,
          camX: this.game.camera.x,
          camY: this.game.camera.y
        };
        return;
      }
      if (!s.moved) {
        const w = this.game.screenToWorld(e.clientX, e.clientY);
        s.world = w;
        this.game.dropPreview = w;
      }
    } else if (s.type === 'piece') {
      if (!s.moved && Math.hypot(dx, dy) > 5) {
        s.moved = true;
        const p = this.game.pieces.find((x) => x.id === s.pieceId);
        if (p) this.game.beginMove(p);
      }
      if (s.moved) {
        const w = this.game.screenToWorld(e.clientX, e.clientY);
        const p = this.game.pieces.find((x) => x.id === s.pieceId);
        if (p) this.game.movePieceTo(p, w.x, w.y - 18 / this.game.camera.zoom);
        this.ui.updateSelection();
      }
    } else if (s.type === 'place') {
      const w = this.game.screenToWorld(e.clientX, e.clientY);
      s.world = w;
      this.game.ghost = {
        kind: 'piece',
        defId: s.defId,
        x: Math.round(w.x / 20) * 20,
        y: Math.round(w.y / 20) * 20,
        rot: 0
      };
    } else if (s.type === 'pan') {
      this.game.camera.x = s.camX - dx / this.game.camera.zoom;
      this.game.camera.y = s.camY - dy / this.game.camera.zoom;
      this.game.saveCamera();
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.single = null;
      this.game.dropPreview = null;
      return;
    }
    const s = this.single;
    if (s && s.pointerId === e.pointerId) {
      if (s.type === 'drop') {
        clearTimeout(s.rainTimer);
        clearInterval(s.rainInterval);
        if (!s.moved && !s.raining) {
          this.game.spawnMarble(s.world.x, s.world.y, this.game.selectedMarble);
        }
        this.game.dropPreview = null;
      } else if (s.type === 'piece') {
        const p = this.game.pieces.find((x) => x.id === s.pieceId);
        if (p && s.moved) this.game.endMove(p, s.fromX, s.fromY);
      } else if (s.type === 'place') {
        if (e.clientY < window.innerHeight - 96) {
          const w = s.world;
          const piece = this.game.addPiece(s.defId, Math.round(w.x / 20) * 20, Math.round(w.y / 20) * 20, 0);
          if (piece && !this.game.armedSticky) this.game.disarmPiece();
        }
        this.game.ghost = null;
      }
      this.single = null;
    }
  };

  private onCancel = (e: PointerEvent) => {
    if (this.single && this.single.pointerId === e.pointerId) {
      if (this.single.type === 'drop') {
        clearTimeout(this.single.rainTimer);
        clearInterval(this.single.rainInterval);
      }
      if (this.single.type === 'piece') {
        const s = this.single;
        const p = this.game.pieces.find((x) => x.id === s.pieceId);
        if (p && s.moved) {
          p.x = s.fromX;
          p.y = s.fromY;
          this.game.physics.rebuild(this.game.pieces);
        }
      }
      if (this.single.type === 'place') this.game.ghost = null;
      this.single = null;
    }
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    this.game.dropPreview = null;
  };

  private cancelSingle() {
    if (this.single?.type === 'drop') {
      clearTimeout(this.single.rainTimer);
      clearInterval(this.single.rainInterval);
    } else if (this.single?.type === 'piece') {
      const s = this.single;
      const p = this.game.pieces.find((x) => x.id === s.pieceId);
      if (p && s.moved) {
        p.x = s.fromX;
        p.y = s.fromY;
        this.game.physics.rebuild(this.game.pieces);
      }
    } else if (this.single?.type === 'place') {
      this.game.ghost = null;
    }
    this.single = null;
    this.game.dropPreview = null;
  }

  private startPinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    this.pinch = {
      startDist: Math.max(1, d),
      startZoom: this.game.camera.zoom,
      startMid: mid,
      worldAtMid: this.game.screenToWorld(mid.x, mid.y)
    };
    this.game.ghost = null;
    this.game.dropPreview = null;
  }

  private updatePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2 || !this.pinch) return;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const zoom = clamp(this.pinch.startZoom * (d / this.pinch.startDist), 0.3, 2.5);
    this.game.camera.zoom = zoom;
    this.game.camera.x = this.pinch.worldAtMid.x - (mid.x - this.game.viewW / 2) / zoom;
    this.game.camera.y = this.pinch.worldAtMid.y - (mid.y - this.game.viewH / 2) / zoom / CAMERA_TILT;
    this.game.saveCamera();
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (isEditableTarget(e.target)) return;
      if (this.game.overlayOpen) {
        if (e.key === 'Escape') this.ui.closeOverlays();
        return;
      }
      const k = e.key;
      if (k === 'Escape') {
        if (this.game.armedDefId) this.game.disarmPiece();
        else this.game.deselect();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.game.redo();
        else this.game.undo();
        this.ui.refreshAll();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'y') {
        e.preventDefault();
        this.game.redo();
        this.ui.refreshAll();
        return;
      }
      const step = 70 / this.game.camera.zoom;
      if (k === 'ArrowLeft') this.game.camera.x -= step;
      else if (k === 'ArrowRight') this.game.camera.x += step;
      else if (k === 'ArrowUp') this.game.camera.y -= step;
      else if (k === 'ArrowDown') this.game.camera.y += step;
      else if (k === '+' || k === '=') this.game.zoomAtScreen(this.game.viewW / 2, this.game.viewH / 2, this.game.camera.zoom * 1.18);
      else if (k === '-') this.game.zoomAtScreen(this.game.viewW / 2, this.game.viewH / 2, this.game.camera.zoom / 1.18);
      else if (k === ' ') {
        e.preventDefault();
        if (this.game.mode === 'play') {
          const w = this.game.screenToWorld(this.game.viewW / 2, this.game.viewH / 2);
          this.game.spawnMarble(w.x, w.y, this.game.selectedMarble);
        }
      } else if (k === 'Delete' || k === 'Backspace') {
        if (this.game.selectedPieceId) {
          this.game.removePiece(this.game.selectedPieceId);
          this.ui.refreshAll();
        }
      }
    });
  }
}
