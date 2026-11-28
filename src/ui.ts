import type { Game } from './game';
import {
  FUNNEL_WIDTHS,
  MARBLE_BY_ID,
  MARBLE_TYPES,
  PIECE_TRAY,
  defaultLen,
  pieceHitSize,
  pieceLength
} from './pieces';
import { drawPreview } from './art';
import { WORLD_THEMES } from './worlds';
import { STRUCTURES } from './structures';
import { CAMERA_TILT, clamp, icon, prefersReducedMotion, shortAngle } from './util';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];

type OverlayId = 'settings';

export class UI {
  game: Game;
  tray = $('#tray');
  selection = $('#selection-ui');
  selRotate = $('#sel-rotate');
  selSize = $('#sel-size');
  selPower = $('#sel-power');
  selDuplicate = $('#sel-duplicate');
  selDelete = $('#sel-delete');
  capacity = $('#capacity');
  capacityNum = $('#capacity-num');
  private undo = $<HTMLButtonElement>('#btn-undo');
  private redo = $<HTMLButtonElement>('#btn-redo');
  private pause = $<HTMLButtonElement>('#btn-pause');
  private sweep = $<HTMLButtonElement>('#btn-sweep');
  private pauseIcon = $<SVGUseElement>('#btn-pause use');
  settings = $('#settings');
  settingsBody = $('#settings-body');
  toastEl = $('#toast');
  flashEl = $('#flash');

  private toastTimer = 0;
  private longPressTimer = 0;
  private longPressId = '';
  private longPressFired = false;
  private longPressStart = { x: 0, y: 0 };
  private selPowerUse: SVGUseElement | null = null;
  private lastSelLeft = -1;
  private lastSelTop = -1;
  private lastCapacity = -1;
  private lastPaused = false;
  private trayMode: 'build' | 'play' | null = null;
  private trayCards = { build: [] as HTMLButtonElement[], play: [] as HTMLButtonElement[] };
  private trayScroll = { build: 0, play: 0 };
  private selectionKey = '';
  private rotating: {
    pieceId: number;
    center: { x: number; y: number };
    startRot: number;
    startAng: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null = null;

  constructor(game: Game) {
    this.game = game;
    this.selPowerUse = this.selPower.querySelector('use');
    this.bind();
    this.refreshAll();
  }

  private bind() {
    $('#mode-build').addEventListener('click', () => this.setMode('build'));
    $('#mode-play').addEventListener('click', () => this.setMode('play'));
    $('#btn-recenter').addEventListener('click', () => {
      this.game.recenter();
      this.game.audio.ui();
      this.game.saveCamera();
    });
    $('#btn-zoom-in').addEventListener('click', () => this.zoomStep(1.25));
    $('#btn-zoom-out').addEventListener('click', () => this.zoomStep(0.8));
    $('#btn-settings').addEventListener('click', () => this.openOverlay('settings'));
    this.undo.addEventListener('click', () => this.game.undo());
    this.redo.addEventListener('click', () => this.game.redo());
    this.pause.addEventListener('click', () => this.game.toggleSimulation());
    this.sweep.addEventListener('click', () => this.game.clearMarbles());

    $$('.close').forEach((btn) => {
      btn.addEventListener('click', () => this.closeOverlays());
    });
    this.settings.addEventListener('pointerdown', (e) => {
      if (e.target === this.settings) this.closeOverlays();
    });

    this.selDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.game.selectedPiece;
      if (p) {
        this.game.removePiece(p.id);
        this.refreshAll();
      }
    });
    this.selDuplicate.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.game.selectedPiece;
      if (p) {
        this.game.duplicatePiece(p);
        this.updateSelection();
      }
    });
    this.selPower.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.game.selectedPiece;
      if (!p || (p.defId !== 'electromagnet' && p.defId !== 'marbleFactory')) return;
      this.game.togglePower(p.id);
      this.updateSelection();
    });
    this.selSize.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.game.selectedPiece;
      if (!p) return;
      if (p.defId === 'ramp') {
        let next = p.len * 2;
        if (next > 1920) next = 80;
        this.game.setPieceLen(p, next, true, p.len);
      } else if (p.defId === 'conveyor' || p.defId === 'bubble') {
        let next = pieceLength(p) * 2;
        if (next > 1920) next = defaultLen(p.defId);
        this.game.setPieceLen(p, next, true, pieceLength(p));
      } else if (p.defId === 'funnel') {
        const i = FUNNEL_WIDTHS.findIndex((v) => v > pieceLength(p) + 1);
        const next = i < 0 ? FUNNEL_WIDTHS[0] : FUNNEL_WIDTHS[i];
        this.game.setPieceLen(p, next, true, pieceLength(p));
      } else if (p.defId === 'portal') {
        const values = [124, 180, 240, 300, 360];
        const i = values.findIndex((v) => v > p.len + 1);
        const next = i < 0 ? values[0] : values[i];
        this.game.setPieceLen(p, next, true, p.len);
      } else {
        return;
      }
      this.game.audio.ui();
      this.updateSelection();
    });
    this.bindRotate();

    this.tray.addEventListener(
      'wheel',
      (e) => {
        if (this.tray.scrollWidth <= this.tray.clientWidth + 2) return;
        e.preventDefault();
        this.tray.scrollLeft += e.deltaY + e.deltaX;
      },
      { passive: false }
    );

    const clearLongPress = () => {
      window.clearTimeout(this.longPressTimer);
    };
    this.tray.addEventListener('pointerdown', (e) => {
      const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!card || card.dataset.kind !== 'piece') return;
      const id = card.dataset.id ?? '';
      this.longPressFired = false;
      this.longPressId = id;
      this.longPressStart = { x: e.clientX, y: e.clientY };
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => {
        if (!this.longPressId) return;
        this.longPressFired = true;
        this.game.armPiece(this.longPressId, true);
      }, 380);
    });
    this.tray.addEventListener('pointermove', (e) => {
      if (!this.longPressId) return;
      if (Math.hypot(e.clientX - this.longPressStart.x, e.clientY - this.longPressStart.y) > 8) {
        this.longPressId = '';
        clearLongPress();
      }
    });
    this.tray.addEventListener('pointerup', clearLongPress);
    this.tray.addEventListener('pointercancel', clearLongPress);
    this.tray.addEventListener('pointerleave', clearLongPress);

    this.tray.addEventListener('click', (e) => {
      if (this.longPressFired) {
        this.longPressFired = false;
        return;
      }
      const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!card) return;
      const kind = card.dataset.kind;
      if (kind === 'piece') {
        const id = card.dataset.id ?? '';
        this.game.armPiece(id);
        return;
      }
      if (kind === 'marble') {
        const id = card.dataset.id ?? 'crystal';
        if (MARBLE_BY_ID.has(id)) {
          this.game.selectedMarble = id;
          this.game.audio.ui();
          this.refreshTray();
          this.game.requestSave();
        }
      }
    });
  }

  private setMode(mode: 'build' | 'play') {
    this.game.setMode(mode);
    this.game.audio.ui();
    this.refreshAll();
  }

  private zoomStep(factor: number) {
    this.game.zoomAtScreen(this.game.viewW / 2, this.game.viewH / 2, this.game.camera.zoom * factor);
    this.game.saveCamera();
    this.game.audio.ui();
  }

  refreshAll() {
    this.refreshHud();
    this.refreshTray();
    this.refreshMode();
    this.updateSelection();
    this.refreshSettings();
  }

  refreshHud() {
    this.undo.disabled = !this.game.canUndo;
    this.redo.disabled = !this.game.canRedo;
    const paused = this.game.simulationPaused;
    if (paused !== this.lastPaused) {
      this.lastPaused = paused;
      this.pause.setAttribute('aria-pressed', String(paused));
      this.pause.title = paused ? 'Reanudar simulación (P)' : 'Pausar simulación (P)';
      this.pauseIcon.setAttribute('href', paused ? '#i-play' : '#i-pause');
    }
    const cap = this.game.pieces.length;
    if (cap !== this.lastCapacity) {
      this.lastCapacity = cap;
      this.capacity.classList.toggle('is-hidden', cap < 1800);
      this.capacityNum.textContent = `${cap}`;
    }
  }

  refreshMode() {
    for (const mode of ['build', 'play'] as const) {
      const button = $(`#mode-${mode}`);
      const active = this.game.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  refreshTray() {
    const mode = this.game.mode;
    const inPlay = mode === 'play';
    const cards = this.trayCards[mode];
    if (this.trayMode !== mode) {
      if (this.trayMode) this.trayScroll[this.trayMode] = this.tray.scrollLeft;
      const fresh = cards.length === 0;
      if (fresh) {
        const items = inPlay ? MARBLE_TYPES : PIECE_TRAY;
        for (const item of items) {
          const card = document.createElement('button');
          card.className = inPlay ? 'card marble-card' : 'card';
          card.dataset.id = item.id;
          card.dataset.kind = inPlay ? 'marble' : 'piece';
          card.title = item.label;
          card.setAttribute('aria-label', item.label);
          card.appendChild(document.createElement('canvas'));
          cards.push(card);
        }
      }
      this.tray.textContent = '';
      this.tray.append(...cards);
      if (fresh) {
        for (const card of cards) drawPreview(card.querySelector('canvas')!, card.dataset.id!, inPlay ? 'marble' : 'piece');
      }
      this.tray.setAttribute('aria-label', inPlay ? 'Bandeja de canicas' : 'Bandeja de piezas');
      this.tray.scrollLeft = this.trayScroll[mode];
      this.trayMode = mode;
    }
    const selected = inPlay ? this.game.selectedMarble : this.game.armedDefId;
    for (const card of cards) {
      const active = card.dataset.id === selected;
      card.classList.toggle('is-active', active);
      card.classList.toggle('is-sticky', !inPlay && active && this.game.armedSticky);
      card.setAttribute('aria-pressed', String(active));
    }
  }

  tick(_now: number) {
    const empty = this.game.marbles.length === 0;
    if (empty !== this.sweep.disabled) this.sweep.disabled = empty;
    this.updateSelection();
  }

  updateSelection() {
    const p = this.game.selectedPiece;
    if (!p || this.game.mode !== 'build' || this.game.overlayOpen) {
      if (!this.selection.classList.contains('is-hidden')) this.selection.classList.add('is-hidden');
      return;
    }
    const hs = pieceHitSize(p);
    const height = (Math.abs(Math.sin(p.rot)) * hs.w + Math.abs(Math.cos(p.rot)) * hs.h) / 2;
    const center = this.game.worldToScreen(p.x, p.y);
    const top = this.game.worldToScreen(p.x, p.y - height - 34 / this.game.camera.zoom);
    if (top.x < -80 || top.x > this.game.viewW + 80 || center.y + (center.y - top.y) < -40 || top.y > this.game.viewH + 50) {
      if (!this.selection.classList.contains('is-hidden')) this.selection.classList.add('is-hidden');
      return;
    }
    if (this.selection.classList.contains('is-hidden')) this.selection.classList.remove('is-hidden');
    const canRotate = p.defId !== 'balance' && p.defId !== 'electromagnet';
    const canSize =
      p.defId === 'ramp' ||
      p.defId === 'portal' ||
      p.defId === 'conveyor' ||
      p.defId === 'bubble' ||
      p.defId === 'funnel';
    const canMagnet = p.defId === 'electromagnet';
    const canFactory = p.defId === 'marbleFactory';
    const canPower = canMagnet || canFactory;
    const repel = canMagnet && (p.polarity ?? 1) < 0;
    const factoryOff = canFactory && p.powered === false;
    const key = `${p.defId}:${repel}:${factoryOff}`;
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      this.selRotate.classList.toggle('is-hidden', !canRotate);
      this.selSize.classList.toggle('is-hidden', !canSize);
      const sizeLabel = p.defId === 'funnel' ? 'Ensanchar embudo' : 'Cambiar longitud';
      this.selSize.setAttribute('aria-label', sizeLabel);
      this.selSize.title = sizeLabel;
      this.selPower.classList.toggle('is-hidden', !canPower);
      this.selPowerUse?.setAttribute('href', canFactory ? '#i-power' : '#i-magnet');
      this.selPower.classList.toggle('repel', repel);
      this.selPower.classList.toggle('off', factoryOff);
      const powerLabel = canFactory
        ? factoryOff ? 'Encender fábrica' : 'Apagar fábrica'
        : repel ? 'Atraer canicas' : 'Repeler canicas';
      this.selPower.setAttribute('aria-label', powerLabel);
      this.selPower.title = powerLabel;
    }
    const count = 3 + (canSize ? 1 : 0) + (canPower ? 1 : 0) - (canRotate ? 0 : 1);
    const width = count * 52 + (count - 1) * 8;
    const left = clamp(top.x - width / 2, 8, this.game.viewW - width - 8);
    const topY = clamp(top.y - 26, 64, this.game.viewH - 150);
    if (Math.abs(left - this.lastSelLeft) > 0.1) {
      this.lastSelLeft = left;
      this.selection.style.left = `${left}px`;
    }
    if (Math.abs(topY - this.lastSelTop) > 0.1) {
      this.lastSelTop = topY;
      this.selection.style.top = `${topY}px`;
    }
  }

  private bindRotate() {
    const angleAt = (e: PointerEvent, center: { x: number; y: number }) =>
      Math.atan2((e.clientY - center.y) / CAMERA_TILT, e.clientX - center.x);
    const start = (e: PointerEvent) => {
      const p = this.game.selectedPiece;
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      const center = this.game.worldToScreen(p.x, p.y);
      const ang = angleAt(e, center);
      this.rotating = {
        pieceId: p.id,
        center,
        startRot: p.rot,
        startAng: ang,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointerId: e.pointerId
      };
      this.selRotate.setPointerCapture(e.pointerId);
      this.game.audio.ui();
    };
    const move = (e: PointerEvent) => {
      if (!this.rotating || this.rotating.pointerId !== e.pointerId) return;
      const p = this.game.pieces.find((x) => x.id === this.rotating!.pieceId);
      if (!p) return;
      if (Math.hypot(e.clientX - this.rotating.startX, e.clientY - this.rotating.startY) > 5) this.rotating.moved = true;
      if (!this.rotating.moved) return;
      const ang = angleAt(e, this.rotating.center);
      let rot = this.rotating.startRot + shortAngle(ang - this.rotating.startAng);
      rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      this.game.setPieceRot(p, rot, false);
      this.updateSelection();
    };
    const end = (e: PointerEvent) => {
      if (!this.rotating || this.rotating.pointerId !== e.pointerId) return;
      const p = this.game.pieces.find((x) => x.id === this.rotating!.pieceId);
      if (p) {
        const { startRot, startAng, center, moved } = this.rotating;
        const delta = moved ? shortAngle(angleAt(e, center) - startAng) : Math.PI / 12;
        const rot = Math.round((startRot + delta) / (Math.PI / 12)) * (Math.PI / 12);
        this.game.setPieceRot(p, rot, true, startRot);
      }
      this.rotating = null;
    };
    this.selRotate.addEventListener('pointerdown', start);
    this.selRotate.addEventListener('pointermove', move);
    this.selRotate.addEventListener('pointerup', end);
    const cancel = (e: PointerEvent) => {
      if (this.rotating?.pointerId !== e.pointerId) return;
      const p = this.game.pieces.find((piece) => piece.id === this.rotating!.pieceId);
      if (p) this.game.setPieceRot(p, this.rotating.startRot);
      this.rotating = null;
    };
    this.selRotate.addEventListener('pointercancel', cancel);
    this.selRotate.addEventListener('lostpointercapture', cancel);
    this.selRotate.addEventListener('click', (e) => {
      const p = this.game.selectedPiece;
      if (p && e.detail === 0) this.game.setPieceRot(p, p.rot + Math.PI / 12, true, p.rot);
    });
  }

  openOverlay(id: OverlayId) {
    this.game.audio.ui();
    $$('.overlay').forEach((el) => el.classList.add('is-hidden'));
    if (id === 'settings') {
      this.settings.classList.remove('is-hidden');
      this.refreshSettings();
    }
    this.game.setOverlayOpen(true);
  }

  closeOverlays() {
    $$('.overlay').forEach((el) => el.classList.add('is-hidden'));
    this.game.setOverlayOpen(false);
    this.game.audio.ui();
    this.refreshAll();
  }

  // ---------------- settings ----------------

  private buildRow(ic: string, label: string, valueHtml: string, action: string, extra = '') {
    return `<div class="set-row tap ${extra}" data-action="${action}" role="button" tabindex="0" aria-label="${label}">
      <div class="set-ic">${icon(ic)}</div>
      <div class="set-label">${label}</div>
      <div class="set-value">${valueHtml}</div>
    </div>`;
  }

  private dots(n: number, max = 3, color = 'on') {
    let out = '';
    for (let i = 0; i < max; i++) out += `<span class="state-dot ${i < n ? color : ''}"></span>`;
    return out;
  }

  private savedAt(ts: number) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  refreshSettings() {
    if (this.settings.classList.contains('is-hidden')) return;
    const s = this.game.settings;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const rows: string[] = [];
    const quality = s.quality === 'high' ? 'Alta' : s.quality === 'low' ? 'Ligera' : 'Automática';
    rows.push(this.buildRow('quality', 'Calidad', quality, 'quality'));
    rows.push(this.buildRow('sound', 'Sonido', ['Silencio', 'Suave', 'Normal'][s.sound], 'sound'));
    rows.push(this.buildRow('haptics', 'Vibración', this.dots(s.haptics && !ios ? 1 : 0, 1), 'haptics'));
    const worldDots = this.game.worlds
      .map((_, i) => {
        const theme = WORLD_THEMES[i] ?? WORLD_THEMES[0];
        return `<button class="world-dot${this.game.activeWorld === i ? ' on' : ''}" data-world="${i}" style="--dot:${theme.accent}" title="${theme.name}" aria-label="Mundo ${i + 1}: ${theme.name}"></button>`;
      })
      .join('');
    const worldName = (WORLD_THEMES[this.game.activeWorld] ?? WORLD_THEMES[0]).name;
    rows.push(`<div class="set-row wide">
      <div class="set-ic">${icon('world')}</div>
      <div class="set-label">Mundos</div>
      <div class="set-value world-dots">${worldDots}<span class="world-now">${worldName}</span></div>
    </div>`);
    if (this.game.hasLastSession) {
      rows.push(
        this.buildRow(
          'play',
          'Última partida',
          `<span class="resume-meta">${this.savedAt(this.game.lastSessionAt)}</span><span class="resume-pill">Reanudar</span>`,
          'resume'
        )
      );
    } else {
      rows.push(`<div class="set-row is-dim">
        <div class="set-ic">${icon('play')}</div>
        <div class="set-label">Última partida</div>
        <div class="set-value"><span class="resume-empty">Sin partida</span></div>
      </div>`);
    }
    const saveSlots = Array.from({ length: 5 }, (_, i) => {
      const has = !!this.game.snapshots[i];
      return `<button class="save-slot${has ? '' : ' is-empty'}" data-slot="${i}"${has ? '' : ' disabled'} aria-label="Cargar partida ${i + 1}">${i + 1}</button>`;
    }).join('');
    rows.push(`<div class="set-row wide">
      <div class="set-ic">${icon('reset')}</div>
      <div class="set-label">Partidas</div>
      <div class="set-value save-slots">${saveSlots}</div>
    </div>`);
    const structureSlots = STRUCTURES.map(
      (s, i) =>
        `<button class="structure-slot" data-structure="${i}" title="${s.name} · ${s.blurb}" aria-label="Cargar estructura ${i + 1}: ${s.name}">${i + 1}</button>`
    ).join('');
    rows.push(`<div class="set-row wide">
      <div class="set-ic">${icon('layers')}</div>
      <div class="set-label">Estructuras</div>
      <div class="set-value structure-slots">${structureSlots}</div>
    </div>`);
    rows.push(this.buildRow('trash', 'Borrar', '', 'clear', 'reset-row'));
    rows.push(`<div class="set-row" style="justify-content:center;border:0;background:transparent;min-height:40px;padding:2px"><span class="tiny">Marblelous v1.12 · sin datos · sin red</span></div>`);
    this.settingsBody.innerHTML = rows.join('');

    this.settingsBody.querySelectorAll<HTMLElement>('.set-row.tap').forEach((row) => {
      const action = row.dataset.action ?? '';
      row.addEventListener('click', () => {
        if (action === 'quality') this.game.cycleQuality();
        else if (action === 'sound') this.game.cycleSound();
        else if (action === 'haptics') this.game.toggleHaptics();
        else if (action === 'resume') {
          if (this.game.resumeLastSession()) {
            this.closeOverlays();
            return;
          }
        } else if (action === 'clear') {
          this.game.clearCanvas();
          this.closeOverlays();
        }
        this.refreshSettings();
        this.refreshHud();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        }
      });
    });
    this.settingsBody.querySelectorAll<HTMLElement>('.world-dot').forEach((dot) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(dot.dataset.world);
        this.game.setWorld(i);
        this.toast('world', (WORLD_THEMES[i] ?? WORLD_THEMES[0]).name);
        this.closeOverlays();
      });
    });
    this.settingsBody.querySelectorAll<HTMLElement>('.save-slot:not(.is-empty)').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(slot.dataset.slot);
        if (this.game.loadSnapshot(i)) this.toast('check', `Partida ${i + 1}`);
        this.closeOverlays();
      });
    });
    this.settingsBody.querySelectorAll<HTMLElement>('.structure-slot').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(slot.dataset.structure);
        if (this.game.loadStructure(i)) this.closeOverlays();
      });
    });
  }

  // ---------------- feedback ----------------

  toast(iconName: string, text?: string) {
    clearTimeout(this.toastTimer);
    this.toastEl.innerHTML = `${icon(iconName)}${text ? `<span>${text}</span>` : ''}`;
    this.toastEl.classList.remove('is-hidden');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
      window.setTimeout(() => this.toastEl.classList.add('is-hidden'), 220);
    }, 1900);
  }

  flash(alpha = 0.18) {
    if (prefersReducedMotion()) return;
    this.flashEl.style.opacity = `${alpha}`;
    this.flashEl.classList.add('on');
    window.setTimeout(() => {
      this.flashEl.classList.remove('on');
      this.flashEl.style.opacity = '';
    }, 70);
  }
}
