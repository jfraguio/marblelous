import type { Game } from './game';
import {
  FUNNEL_WIDTHS,
  METER_INTERVALS,
  MARBLE_BY_ID,
  MARBLE_TYPES,
  PIECE_TRAY,
  defaultLen,
  pieceLength,
  pieceHitSize,
  noteLabel,
  xyloNotes,
  XYLO_NOTES
} from './pieces';
import { drawPreview, drawWorkshopPreview } from './art';
import { WORLD_THEMES, worldTheme } from './worlds';
import { FIRST_CIRCUIT, FIRST_DROP, SHORT_CIRCUITS, STRUCTURES, type StructureDef } from './structures';
import { CAMERA_TILT, clamp, icon, prefersReducedMotion, shortAngle } from './util';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];

type OverlayId = 'settings' | 'album' | 'tuning';

export class UI {
  game: Game;
  tray = $('#tray');
  selection = $('#selection-ui');
  selRotate = $('#sel-rotate');
  selSize = $('#sel-size');
  selPower = $('#sel-power');
  selDuplicate = $('#sel-duplicate');
  selDelete = $('#sel-delete');
  private selPrecision = $('#sel-precision');
  private selNotes = $('#sel-notes');
  private nudge = $('#nudge-controls');
  private firstDrop = $<HTMLButtonElement>('#first-drop');
  private hint = $('#workshop-hint');
  private hintText = $('#hint-text');
  private album = $('#album');
  private tuning = $('#tuning');
  private rename = $<HTMLFormElement>('#rename-workshop');
  private workshopName = $<HTMLInputElement>('#workshop-name');
  private renameId = '';
  private lastHint = '';
  private lastDropLeft = -1;
  private lastDropTop = -1;
  capacity = $('#capacity');
  capacityNum = $('#capacity-num');
  private pause = $<HTMLButtonElement>('#btn-pause');
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
    $('#new-workshop').addEventListener('click', () => {
      this.game.newWorkshop();
      this.refreshAlbum();
      this.beginRename(this.game.workshop.id, this.game.workshop.name, true);
    });
    this.rename.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.workshopName.value.trim()) return;
      this.game.renameWorkshop(this.renameId, this.workshopName.value);
      this.rename.classList.add('is-hidden');
      this.refreshAlbum();
    });
    this.firstDrop.addEventListener('click', () => this.game.startIntroMarble());
    $('#dismiss-hint').addEventListener('click', () => this.game.dismissIntro());
    this.pause.addEventListener('click', () => this.game.toggleSimulation());

    $$('.close').forEach((btn) => {
      btn.addEventListener('click', () => this.closeOverlays());
    });
    for (const overlay of [this.settings, this.album, this.tuning]) {
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) this.closeOverlays();
      });
    }

    this.selPrecision.addEventListener('click', () => {
      const open = this.nudge.classList.toggle('is-hidden');
      this.selPrecision.setAttribute('aria-expanded', String(!open));
    });
    this.selNotes.addEventListener('click', () => this.openOverlay('tuning'));
    $$('#nudge-controls button').forEach((button) => {
      button.addEventListener('click', () => {
        const [x, y] = button.dataset.nudge!.split(',').map(Number);
        this.game.nudgeSelection(x, y);
      });
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
      const piece = this.game.selectedPiece;
      if (piece) this.game.duplicatePiece(piece);
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
      } else if (p.defId === 'meter') {
        this.game.cycleTempo(p);
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
    this.updateSelection();
    this.updateHint();
  }

  private updateHint() {
    const g = this.game;
    const again = g.workshop.intro === 'again';
    const drop = (g.workshop.intro === 'drop' || again) && !g.introMarbleId && !g.testDropArmed;
    this.firstDrop.classList.toggle('is-hidden', !drop);
    if (drop) {
      const label = again ? 'Volver a probar' : 'Soltar una canica';
      if (this.firstDrop.title !== label) {
        this.firstDrop.title = label;
        this.firstDrop.querySelector('span')!.textContent = label;
      }
      const p = g.worldToScreen(FIRST_DROP.x, FIRST_DROP.y);
      const left = Math.round(clamp(p.x, 69, g.viewW - 69));
      const top = Math.round(clamp(p.y - 16, 62, g.viewH - 128));
      if (left !== this.lastDropLeft || top !== this.lastDropTop) {
        this.firstDrop.style.transform = `translate(${left}px, ${top}px) translate(-50%, -50%)`;
        this.lastDropLeft = left;
        this.lastDropTop = top;
      }
    }
    const text = g.testDropArmed ? 'Prueba de una canica · Esc para cancelar'
      : g.workshop.intro === 'edit' ? 'Mueve el Canal en S y escucha qué cambia.'
      : g.introMarbleId ? 'Sigue la canica hasta el xilófono.' : '';
    if (text !== this.lastHint) {
      this.lastHint = text;
      this.hintText.textContent = text;
      this.hint.classList.toggle('is-hidden', !text);
      $('#dismiss-hint').classList.toggle('is-hidden', !g.workshop.intro || g.testDropArmed);
    }
  }

  updateSelection() {
    const p = this.game.selectedPiece;
    if (!p || this.game.mode !== 'build' || this.game.overlayOpen) {
      if (!this.selection.classList.contains('is-hidden')) this.selection.classList.add('is-hidden');
      return;
    }
    const { w, h } = pieceHitSize(p);
    const cos = Math.abs(Math.cos(p.rot));
    const sin = Math.abs(Math.sin(p.rot));
    const halfWidth = (w * cos + h * sin) / 2;
    const halfHeight = (w * sin + h * cos) / 2;
    const center = this.game.worldToScreen(p.x, p.y);
    const extentX = halfWidth * this.game.camera.zoom;
    const extentY = halfHeight * this.game.camera.zoom * CAMERA_TILT;
    const topY = center.y - extentY - 28 * CAMERA_TILT;
    if (center.x + extentX < -50 || center.x - extentX > this.game.viewW + 50 || center.y + extentY < -40 || topY > this.game.viewH + 50) {
      if (!this.selection.classList.contains('is-hidden')) this.selection.classList.add('is-hidden');
      return;
    }
    if (this.selection.classList.contains('is-hidden')) this.selection.classList.remove('is-hidden');
    const id = p.defId;
    const canRotate = id !== 'balance' && id !== 'electromagnet';
    const canSize =
      id === 'ramp' || id === 'portal' || id === 'conveyor' || id === 'bubble' || id === 'funnel' || id === 'meter';
    const canMagnet = id === 'electromagnet';
    const canFactory = id === 'marbleFactory';
    const canPower = canMagnet || canFactory;
    const canTune = id === 'xylo5';
    const repel = canMagnet && (p.polarity ?? 1) < 0;
    const factoryOff = canFactory && p.powered === false;
    const key = `${id}:${repel}:${factoryOff}:${p.variant}`;
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      this.selRotate.classList.toggle('is-hidden', !canRotate);
      this.selSize.classList.toggle('is-hidden', !canSize);
      this.selNotes.classList.toggle('is-hidden', !canTune);
      const sizeLabel = id === 'meter' ? `Intervalo: ${METER_INTERVALS[p.variant].toLocaleString('es')} s`
        : id === 'funnel' ? 'Ensanchar embudo' : 'Cambiar longitud';
      this.selSize.setAttribute('aria-label', sizeLabel);
      this.selSize.title = sizeLabel;
      this.selSize.querySelector('use')?.setAttribute('href', id === 'meter' ? '#i-pause' : '#i-resize');
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
    const count = 3 + Number(canSize) + Number(canPower) + Number(canRotate) + Number(canTune);
    const compact = this.game.viewW <= 720;
    const width = Math.max(this.nudge.classList.contains('is-hidden') ? 0 : 158, count * (compact ? 42 : 52) + (count - 1) * (compact ? 6 : 8));
    const left = clamp(center.x - width / 2, 8, this.game.viewW - width - 8);
    const top = clamp(topY - 26, 64, this.game.viewH - 150);
    if (Math.abs(left - this.lastSelLeft) > 0.1) {
      this.lastSelLeft = left;
      this.selection.style.left = `${left}px`;
    }
    if (Math.abs(top - this.lastSelTop) > 0.1) {
      this.lastSelTop = top;
      this.selection.style.top = `${top}px`;
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
    this.game.setOverlayOpen(true);
    $$('.overlay').forEach((el) => el.classList.toggle('is-hidden', el.id !== id));
    if (id === 'settings') {
      this.refreshSettings();
    } else if (id === 'album') {
      this.rename.classList.add('is-hidden');
      this.refreshAlbum();
    } else {
      this.refreshTuning();
    }
    this.updateSelection();
    this.firstDrop.classList.add('is-hidden');
    this.hint.classList.add('is-hidden');
    this.lastHint = '';
  }

  closeOverlays() {
    $$('.overlay').forEach((el) => el.classList.add('is-hidden'));
    this.game.setOverlayOpen(false);
    this.game.audio.ui();
    this.refreshAll();
  }

  private beginRename(id: string, name: string, select = false) {
    this.renameId = id;
    this.workshopName.value = name;
    this.rename.classList.remove('is-hidden');
    this.workshopName.focus();
    if (select) this.workshopName.select();
  }

  private refreshAlbum() {
    const list = $('#workshop-list');
    list.textContent = '';
    const sorted = [...this.game.workshops].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const workshop of sorted) {
      const card = document.createElement('article');
      const active = this.game.workshop.id === workshop.id;
      card.className = `workshop-card${active ? ' active' : ''}`;
      const open = document.createElement('button');
      open.className = 'open-workshop';
      open.setAttribute('aria-label', `Abrir ${workshop.name}`);
      if (active) open.setAttribute('aria-current', 'true');
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      drawWorkshopPreview(canvas, workshop.pieces, worldTheme(workshop.theme).paper2);
      const name = document.createElement('strong');
      name.textContent = workshop.name;
      const detail = document.createElement('small');
      detail.textContent = active ? 'Taller actual' : this.savedAt(workshop.updatedAt);
      open.append(canvas, name, detail);
      open.addEventListener('click', () => {
        this.game.openWorkshop(workshop.id);
        this.closeOverlays();
      });
      const actions = document.createElement('div');
      actions.className = 'workshop-actions';
      const rename = document.createElement('button');
      rename.innerHTML = icon('edit');
      rename.setAttribute('aria-label', `Renombrar ${workshop.name}`);
      rename.addEventListener('click', () => this.beginRename(workshop.id, workshop.name, true));
      const remove = document.createElement('button');
      remove.innerHTML = icon('trash');
      remove.setAttribute('aria-label', `Eliminar ${workshop.name}`);
      remove.addEventListener('click', () => {
        if (!window.confirm(`¿Eliminar «${workshop.name}» del álbum?`)) return;
        this.game.deleteWorkshop(workshop.id);
        this.rename.classList.add('is-hidden');
        this.refreshAlbum();
      });
      actions.append(rename, remove);
      card.append(open, actions);
      list.appendChild(card);
    }
    this.showCircuits($('#circuit-list'), SHORT_CIRCUITS);
    this.showCircuits($('#classic-list'), STRUCTURES);
  }

  private showCircuits(list: HTMLElement, circuits: StructureDef[]) {
    if (list.childElementCount) return;
    for (const circuit of circuits) {
      const button = document.createElement('button');
      const name = document.createElement('strong');
      const hint = document.createElement('small');
      name.textContent = circuit.name;
      hint.textContent = circuit.blurb;
      button.setAttribute('aria-label', `Probar ${circuit.name}`);
      button.append(name, hint);
      button.addEventListener('click', () => {
        this.game.newWorkshop(circuit.name, circuit.pieces, circuit.id === FIRST_CIRCUIT.id);
        this.closeOverlays();
      });
      list.appendChild(button);
    }
  }

  private refreshTuning() {
    const piece = this.game.selectedPiece;
    if (piece?.defId !== 'xylo5') return;
    const body = $('#tuning-body');
    const notes = xyloNotes(piece.notes);
    body.innerHTML = '<p class="tuning-help">Elige una nota por lámina. Las cinco forman la misma escala.</p>';
    for (const [i, note] of notes.entries()) {
      const row = document.createElement('label');
      row.className = 'tuning-row';
      row.textContent = `Lámina ${i + 1}`;
      const select = document.createElement('select');
      for (const pitch of XYLO_NOTES) select.add(new Option(noteLabel(pitch), String(pitch), false, pitch === note));
      select.addEventListener('change', () => this.game.tuneBar(piece, i, Number(select.value)));
      row.appendChild(select);
      body.appendChild(row);
    }
  }

  // ---------------- settings ----------------

  private buildRow(ic: string, label: string, valueHtml: string, action: string, extra = '') {
    return `<div class="set-row tap ${extra}" data-action="${action}" role="button" tabindex="0" aria-label="${label}">
      <div class="set-ic">${icon(ic)}</div>
      <div class="set-label">${label}</div>
      <div class="set-value">${valueHtml}</div>
    </div>`;
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
    const rows: string[] = [];
    const quality = s.quality === 'high' ? 'Alta' : s.quality === 'low' ? 'Ligera' : 'Automática';
    rows.push(this.buildRow('quality', 'Calidad', quality, 'quality'));
    rows.push(this.buildRow('sound', 'Sonido', ['Silencio', 'Suave', 'Normal'][s.sound], 'sound'));
    rows.push(this.buildRow('haptics', 'Vibración', s.haptics ? 'Activada' : 'Desactivada', 'haptics'));
    const worldDots = WORLD_THEMES
      .map((theme, i) => {
        return `<button class="world-dot${this.game.activeWorld === i ? ' on' : ''}" data-world="${i}" style="--dot:${theme.accent}" title="${theme.name}" aria-label="Mundo ${i + 1}: ${theme.name}"></button>`;
      })
      .join('');
    const worldName = (WORLD_THEMES[this.game.activeWorld] ?? WORLD_THEMES[0]).name;
    rows.push(`<div class="set-row wide">
      <div class="set-ic">${icon('world')}</div>
      <div class="set-label">Mundos</div>
      <div class="set-value world-dots">${worldDots}<span class="world-now">${worldName}</span></div>
    </div>`);
    rows.push(this.buildRow('book', 'Álbum de talleres', 'Abrir', 'album'));
    rows.push(this.buildRow('sweep', 'Limpiar canicas', '', 'clear-marbles'));
    rows.push(this.buildRow('trash', 'Vaciar taller', '', 'clear', 'reset-row'));
    rows.push(`<div class="set-row" style="justify-content:center;border:0;background:transparent;min-height:40px;padding:2px"><span class="tiny">Marblelous v1.13 · guardado local · sin red</span></div>`);
    this.settingsBody.innerHTML = rows.join('');

    this.settingsBody.querySelectorAll<HTMLElement>('.set-row.tap').forEach((row) => {
      const action = row.dataset.action ?? '';
      if (action === 'haptics') row.setAttribute('aria-pressed', String(s.haptics));
      row.addEventListener('click', () => {
        if (action === 'quality') this.game.cycleQuality();
        else if (action === 'sound') this.game.cycleSound();
        else if (action === 'haptics') this.game.toggleHaptics();
        else if (action === 'album') {
          this.openOverlay('album');
          return;
        } else if (action === 'clear-marbles') {
          this.game.clearMarbles();
          this.closeOverlays();
          return;
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
