import type { DropSummary } from './types';
import type { Game } from './game';
import {
  FUNNEL_WIDTHS,
  MARBLE_BY_ID,
  SHOP_ITEMS,
  defaultLen,
  getPieceDef,
  pieceHitSize,
  pieceLength
} from './pieces';
import { drawPreview } from './art';
import { WORLD_THEMES } from './worlds';
import { clamp, fmt, icon, prefersReducedMotion, shortAngle } from './util';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];

type OverlayId = 'settings';

export class UI {
  game: Game;
  tray = $('#tray');
  combo = $('#combo');
  comboMult = $('#combo-mult');
  comboRing = $('.combo-ring');
  selection = $('#selection-ui');
  selRotate = $('#sel-rotate');
  selSize = $('#sel-size');
  selPower = $('#sel-power');
  selDuplicate = $('#sel-duplicate');
  selDelete = $('#sel-delete');
  capacity = $('#capacity');
  capacityNum = $('#capacity-num');
  settings = $('#settings');
  settingsBody = $('#settings-body');
  toastEl = $('#toast');
  summaryEl = $('#summary');
  flashEl = $('#flash');

  private toastTimer = 0;
  private summaryTimer = 0;
  private longPressTimer = 0;
  private longPressId = '';
  private longPressFired = false;
  private longPressStart = { x: 0, y: 0 };
  private selPowerUse: SVGUseElement | null = null;
  private lastSelLeft = -1;
  private lastSelTop = -1;
  private lastCapacity = -1;
  private lastComboKey = '';
  private rotating: {
    pieceId: number;
    center: { x: number; y: number };
    startRot: number;
    startAng: number;
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
        this.game.audio.ui();
        this.refreshTray();
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
        this.refreshTray();
        return;
      }
      if (kind === 'marble') {
        const id = card.dataset.id ?? 'crystal';
        if (this.game.owned.has(id)) {
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
    const cap = this.game.pieces.length;
    if (cap !== this.lastCapacity) {
      this.lastCapacity = cap;
      this.capacity.classList.toggle('is-hidden', cap < 1800);
      this.capacityNum.textContent = `${cap}`;
    }
    const now = performance.now();
    const showCombo = this.game.comboChain > 0 && now - this.game.comboAt < 2500;
    const mult = this.game.comboMultiplier;
    const key = showCombo ? `${this.game.comboChain}|${mult}` : 'hidden';
    if (key === this.lastComboKey) return;
    this.lastComboKey = key;
    this.combo.classList.toggle('is-hidden', !showCombo);
    if (!showCombo) return;
    const pct = clamp((this.game.comboChain / 80) * 100, 0, 100);
    this.comboRing.style.setProperty('--combo', `${pct}`);
    this.comboMult.textContent = `×${Number.isInteger(mult) ? mult : mult.toFixed(2).replace('0', '')}`;
  }

  refreshMode() {
    $('#mode-build').classList.toggle('is-active', this.game.mode === 'build');
    $('#mode-play').classList.toggle('is-active', this.game.mode === 'play');
  }

  refreshTray() {
    const scroll = this.tray.scrollLeft;
    this.tray.innerHTML = '';
    const inPlay = this.game.mode === 'play';
    if (inPlay) {
      for (const type of [...MARBLE_BY_ID.values()]) {
        if (!this.game.owned.has(type.id)) continue;
        const card = document.createElement('button');
        card.className = `card marble-card${this.game.selectedMarble === type.id ? ' is-active' : ''}`;
        card.dataset.id = type.id;
        card.dataset.kind = 'marble';
        card.title = type.label;
        card.setAttribute('aria-label', type.label);
        const canvas = document.createElement('canvas');
        card.appendChild(canvas);
        this.tray.appendChild(card);
        drawPreview(canvas, type.id, 'marble');
      }
    } else {
      const items = SHOP_ITEMS.filter((it) => it.kind === 'piece' && this.game.owned.has(it.id));
      for (const item of items) {
        const card = document.createElement('button');
        card.className = `card${this.game.armedDefId === item.id ? ' is-active' : ''}`;
        card.dataset.id = item.id;
        card.dataset.kind = 'piece';
        const name = getPieceDef(item.id).label;
        card.title = name;
        card.setAttribute('aria-label', name);
        const canvas = document.createElement('canvas');
        card.appendChild(canvas);
        this.tray.appendChild(card);
        drawPreview(canvas, item.id, 'piece');
      }
    }
    this.tray.scrollLeft = scroll;
  }

  tick(now: number) {
    this.updateSelection();
    if (this.game.comboChain > 0 && now - this.game.comboAt > 2500) {
      this.combo.classList.add('is-hidden');
    }
  }

  updateSelection() {
    const p = this.game.selectedPiece;
    if (!p || this.game.mode !== 'build' || this.game.overlayOpen) {
      if (!this.selection.classList.contains('is-hidden')) this.selection.classList.add('is-hidden');
      return;
    }
    const hs = pieceHitSize(p);
    const top = this.game.worldToScreen(p.x, p.y - hs.h * 0.5 - 34 / this.game.camera.zoom);
    if (top.x < -80 || top.x > this.game.viewW + 80 || top.y < -80 || top.y > this.game.viewH + 80) {
      if (!this.selection.classList.contains('is-hidden')) this.selection.classList.add('is-hidden');
      return;
    }
    this.selection.classList.remove('is-hidden');
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
    this.selRotate.classList.toggle('is-hidden', !canRotate);
    this.selSize.classList.toggle('is-hidden', !canSize);
    const sizeLabel = p.defId === 'funnel' ? 'Ensanchar embudo' : 'Cambiar longitud';
    this.selSize.setAttribute('aria-label', sizeLabel);
    this.selSize.title = sizeLabel;
    this.selPower.classList.toggle('is-hidden', !canPower);
    this.selPowerUse?.setAttribute('href', canFactory ? '#i-power' : '#i-magnet');
    const repel = canMagnet && (p.polarity ?? 1) < 0;
    const factoryOff = canFactory && p.powered === false;
    this.selPower.classList.toggle('repel', repel);
    this.selPower.classList.toggle('off', factoryOff);
    const powerLabel = canFactory
      ? factoryOff
        ? 'Encender fábrica'
        : 'Apagar fábrica'
      : repel
        ? 'Atraer canicas'
        : 'Repeler canicas';
    this.selPower.setAttribute('aria-label', powerLabel);
    this.selPower.title = powerLabel;
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
    const start = (e: PointerEvent) => {
      const p = this.game.selectedPiece;
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      const center = this.game.worldToScreen(p.x, p.y);
      const ang = Math.atan2(e.clientY - center.y, e.clientX - center.x);
      this.rotating = {
        pieceId: p.id,
        center,
        startRot: p.rot,
        startAng: ang,
        pointerId: e.pointerId
      };
      this.selRotate.setPointerCapture(e.pointerId);
      this.game.audio.ui();
    };
    const move = (e: PointerEvent) => {
      if (!this.rotating || this.rotating.pointerId !== e.pointerId) return;
      const p = this.game.pieces.find((x) => x.id === this.rotating!.pieceId);
      if (!p) return;
      const ang = Math.atan2(e.clientY - this.rotating.center.y, e.clientX - this.rotating.center.x);
      let rot = this.rotating.startRot + shortAngle(ang - this.rotating.startAng);
      rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      this.game.setPieceRot(p, rot, false);
      this.updateSelection();
    };
    const end = (e: PointerEvent) => {
      if (!this.rotating || this.rotating.pointerId !== e.pointerId) return;
      const p = this.game.pieces.find((x) => x.id === this.rotating!.pieceId);
      if (p) {
        let rot = this.rotating.startRot + shortAngle(Math.atan2(e.clientY - this.rotating.center.y, e.clientX - this.rotating.center.x) - this.rotating.startAng);
        rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
        this.game.setPieceRot(p, rot, true, this.rotating.startRot);
        this.game.requestSave();
      }
      this.rotating = null;
    };
    this.selRotate.addEventListener('pointerdown', start);
    this.selRotate.addEventListener('pointermove', move);
    this.selRotate.addEventListener('pointerup', end);
    this.selRotate.addEventListener('pointercancel', end);
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

  refreshSettings() {
    if (this.settings.classList.contains('is-hidden')) return;
    const s = this.game.settings;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const rows: string[] = [];
    const q = s.quality === 'high' ? 3 : s.quality === 'low' ? 1 : 2;
    rows.push(this.buildRow('quality', 'Calidad', this.dots(q, 3, 'warn'), 'quality'));
    rows.push(this.buildRow('haptics', 'Vibración', this.dots(s.haptics && !ios ? 1 : 0, 1), 'haptics'));
    const worldDots = this.game.worlds
      .map((_, i) => {
        const theme = WORLD_THEMES[i] ?? WORLD_THEMES[0];
        return `<button class="world-dot${this.game.activeWorld === i ? ' on' : ''}" data-world="${i}" style="--dot:${theme.accent}" title="${theme.name}" aria-label="Mundo ${i + 1}: ${theme.name}"></button>`;
      })
      .join('');
    const worldName = (WORLD_THEMES[this.game.activeWorld] ?? WORLD_THEMES[0]).name;
    rows.push(`<div class="set-row">
      <div class="set-ic">${icon('world')}</div>
      <div class="set-label">Mundos</div>
      <div class="set-value world-dots">${worldDots}<span class="world-now">${worldName}</span></div>
    </div>`);
    const saveSlots = Array.from({ length: 5 }, (_, i) => {
      const has = !!this.game.snapshots[i];
      return `<button class="save-slot${has ? '' : ' is-empty'}" data-slot="${i}"${has ? '' : ' disabled'} aria-label="Cargar partida ${i + 1}">${i + 1}</button>`;
    }).join('');
    rows.push(`<div class="set-row">
      <div class="set-ic">${icon('reset')}</div>
      <div class="set-label">Partidas</div>
      <div class="set-value save-slots">${saveSlots}</div>
    </div>`);
    rows.push(this.buildRow('trash', 'Borrar', '', 'clear', 'reset-row'));
    rows.push(`<div class="set-row" style="justify-content:center;border:0;background:transparent;min-height:40px;padding:2px"><span class="tiny">Marblelous v1.11 · sin datos · sin red</span></div>`);
    this.settingsBody.innerHTML = rows.join('');

    this.settingsBody.querySelectorAll<HTMLElement>('.set-row.tap').forEach((row) => {
      const action = row.dataset.action ?? '';
      row.addEventListener('click', () => {
        if (action === 'quality') this.game.cycleQuality();
        else if (action === 'haptics') this.game.toggleHaptics();
        else if (action === 'clear') {
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

  showSummary(s: DropSummary) {
    clearTimeout(this.summaryTimer);
    this.summaryEl.innerHTML = `
      <div class="s-item">${icon('spark')}${fmt(s.sparks)}</div>
      <div class="sep"></div>
      <div class="s-item note">${icon('note')}${s.notes}</div>
      <div class="s-item">${icon('trophy')}${s.goals}</div>
    `;
    this.summaryEl.classList.remove('is-hidden');
    void this.summaryEl.offsetWidth;
    this.summaryEl.classList.add('show');
    this.summaryTimer = window.setTimeout(() => {
      this.summaryEl.classList.remove('show');
      window.setTimeout(() => this.summaryEl.classList.add('is-hidden'), 260);
    }, 4200);
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
