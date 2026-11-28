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
    }
  | null;

interface Pinch {
  startDist: number;
  startZoom: number;
  worldAtMid: Screen;
}

export class Input {
  private game: Game;
  private ui: UI;
  private canvas: HTMLCanvasElement;
  private pointers = new Map<number, Screen>();
  private single: Single = null;
  private pinch: Pinch | null = null;

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
    c.addEventListener('lostpointercapture', this.onCancel);
    c.addEventListener('pointerleave', () => {
      if (!this.single) this.game.clearPreview();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.game.overlayOpen) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0014);
        this.game.zoomAtScreen(e.clientX, e.clientY, this.game.camera.zoom * factor);
        this.game.saveCamera();
      },
      { passive: false }
    );
  }

  private unlockAudio() {
    void this.game.audio.unlock();
  }

  private onDown = (e: PointerEvent) => {
    if (this.game.overlayOpen || e.button !== 0) return;
    if (this.pointers.size >= 2) return;
    e.preventDefault();
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
        defId: this.game.armedDefId
      };
      this.game.previewPiece(this.game.armedDefId, world.x, world.y);
      return;
    }
    if (this.game.mode === 'play') {
      const hit = this.game.getPieceAt(world.x, world.y);
      if (hit?.defId === 'electromagnet' || hit?.defId === 'marbleFactory') {
        this.game.togglePower(hit.id);
        return;
      }
      const rainTimer = window.setTimeout(() => {
        if (!this.single || this.single.type !== 'drop' || this.single.moved) return;
        this.single.raining = true;
        const rain = () => {
          if (!this.single || this.single.type !== 'drop' || this.game.isPaused) return;
          const w = this.single.world;
          this.game.spawnMarble(w.x, w.y, this.game.selectedMarble);
        };
        rain();
        this.single.rainInterval = window.setInterval(rain, 135);
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
    if (!s) {
      if (e.pointerType === 'mouse' && !this.game.overlayOpen && this.game.armedDefId) {
        const w = this.game.screenToWorld(e.clientX, e.clientY);
        this.game.previewPiece(this.game.armedDefId, w.x, w.y);
      }
      return;
    }
    if (s.pointerId !== e.pointerId) return;
    if (s.type === 'place') {
      const w = this.game.screenToWorld(e.clientX, e.clientY);
      this.game.previewPiece(s.defId, w.x, w.y);
      return;
    }
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
        this.game.panByScreen(dx, dy);
        this.game.saveCamera();
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
        const p = this.game.pieces.find((x) => x.id === s.pieceId);
        const zoom = this.game.camera.zoom;
        if (p) this.game.movePieceTo(p, s.fromX + dx / zoom, s.fromY + dy / (zoom * CAMERA_TILT));
      }
    } else if (s.type === 'pan') {
      this.game.camera.x = s.camX - dx / this.game.camera.zoom;
      this.game.camera.y = s.camY - dy / (this.game.camera.zoom * CAMERA_TILT);
      this.game.saveCamera();
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
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
        if (!s.moved && !s.raining && !this.game.isPaused && document.elementFromPoint(e.clientX, e.clientY) === this.canvas) {
          this.game.spawnMarble(s.world.x, s.world.y, this.game.selectedMarble);
        }
        this.game.dropPreview = null;
      } else if (s.type === 'piece') {
        const p = this.game.pieces.find((x) => x.id === s.pieceId);
        if (p && s.moved) {
          if (this.game.overlayOpen || document.elementFromPoint(e.clientX, e.clientY) !== this.canvas) {
            this.game.cancelMove(p, s.fromX, s.fromY);
          } else {
            this.game.endMove(p, s.fromX, s.fromY);
          }
        }
      } else if (s.type === 'place') {
        if (this.game.armedDefId === s.defId && !this.game.overlayOpen && document.elementFromPoint(e.clientX, e.clientY) === this.canvas) {
          const w = this.game.screenToWorld(e.clientX, e.clientY);
          this.game.previewPiece(s.defId, w.x, w.y);
          const piece = this.game.placePreview();
          if (piece && !this.game.armedSticky) this.game.disarmPiece();
        }
        this.game.clearPreview();
      }
      this.single = null;
    }
  };

  private onCancel = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.single?.pointerId === e.pointerId) this.cancelSingle();
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
      if (p && s.moved) this.game.cancelMove(p, s.fromX, s.fromY);
    }
    this.game.clearPreview();
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
      worldAtMid: this.game.screenToWorld(mid.x, mid.y)
    };
    this.game.clearPreview();
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
        this.cancelSingle();
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
      else if (k.toLowerCase() === 'p' && !e.repeat && !e.metaKey && !e.ctrlKey) this.game.toggleSimulation();
      else if (k === ' ') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault();
        if (this.game.mode === 'play') {
          this.unlockAudio();
          const w = this.game.screenToWorld(this.game.viewW / 2, this.game.viewH / 2);
          this.game.spawnMarble(w.x, w.y, this.game.selectedMarble);
        }
      } else if (k === 'Delete' || k === 'Backspace') {
        if (this.game.selectedPieceId) {
          this.game.removePiece(this.game.selectedPieceId);
          this.ui.refreshAll();
        }
      }
      if (k.startsWith('Arrow') || k === '+' || k === '=' || k === '-') this.game.saveCamera();
    });
  }
}
