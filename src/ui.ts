import type { ChallengeDef, DropSummary } from './types';
import type { Game } from './game';
import { CHALLENGES } from './game';
import {
  COLORS,
  MARBLE_BY_ID,
  PIECE_BY_ID,
  SHOP_ITEMS,
  getPieceDef,
  pieceHitSize,
  noteLabel
} from './pieces';
import { drawPreview } from './art';
import { clamp, fmt, icon, shortAngle } from './util';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];

type OverlayId = 'challenges' | 'settings' | 'pause';

export class UI {
  game: Game;
  tray = $('#tray');
  currency = $('#currency');
  sparks = $('#sparks');
  combo = $('#combo');
  comboMult = $('#combo-mult');
  comboRing = $('.combo-ring');
  btnUndo = $('#btn-undo') as HTMLButtonElement;
  btnRedo = $('#btn-redo') as HTMLButtonElement;
  btnClear = $('#btn-clear') as HTMLButtonElement;
  btnSound = $('#btn-sound');
  soundIcon = $('#sound-icon');
  selection = $('#selection-ui');
  selRotate = $('#sel-rotate');
  selSize = $('#sel-size');
  selColor = $('#sel-color');
  selDuplicate = $('#sel-duplicate');
  selDelete = $('#sel-delete');
  capacity = $('#capacity');
  capacityNum = $('#capacity-num');
  tutorial = $('#tutorial');
  tutorialSkip = $('#tutorial-skip');
  challenges = $('#challenges');
  challengeGrid = $('#challenge-grid');
  chSparks = $('#ch-sparks');
  settings = $('#settings');
  settingsBody = $('#settings-body');
  pause = $('#pause');
  toastEl = $('#toast');
  summaryEl = $('#summary');
  flashEl = $('#flash');

  private toastTimer = 0;
  private summaryTimer = 0;
  private tutorialTimer = 0;
  private lastCurrency = -1;
  private lastTutorialPos = 0;
  private rotating: {
    pieceId: number;
    center: { x: number; y: number };
    startRot: number;
    startAng: number;
    pointerId: number;
  } | null = null;

  constructor(game: Game) {
    this.game = game;
    this.bind();
    this.refreshAll();
  }

  private bind() {
    $('#mode-build').addEventListener('click', () => this.setMode('build'));
    $('#mode-play').addEventListener('click', () => this.setMode('play'));
    this.btnUndo.addEventListener('click', () => {
      this.game.undo();
      this.refreshAll();
    });
    this.btnRedo.addEventListener('click', () => {
      this.game.redo();
      this.refreshAll();
    });
    $('#btn-recenter').addEventListener('click', () => {
      this.game.recenter();
      this.game.audio.ui();
      this.game.saveCamera();
    });
    this.btnClear.addEventListener('click', () => {
      this.game.clearMarbles();
      this.toast('broom');
    });
    $('#btn-pause').addEventListener('click', () => this.openOverlay('pause'));
    $('#btn-challenges').addEventListener('click', () => this.openOverlay('challenges'));
    $('#btn-settings').addEventListener('click', () => this.openOverlay('settings'));
    this.btnSound.addEventListener('click', () => {
      this.game.cycleSound();
      this.refreshHud();
    });

    $$('.close').forEach((btn) => {
      btn.addEventListener('click', () => this.closeOverlays());
    });
    this.challenges.addEventListener('pointerdown', (e) => {
      if (e.target === this.challenges) this.closeOverlays();
    });
    this.settings.addEventListener('pointerdown', (e) => {
      if (e.target === this.settings) this.closeOverlays();
    });
    this.pause.addEventListener('pointerdown', (e) => {
      if (e.target === this.pause) this.closeOverlays();
    });

    $('#btn-resume').addEventListener('click', () => this.closeOverlays());
    $('#pause-clear').addEventListener('click', () => {
      this.game.clearMarbles();
      this.toast('broom');
    });
    $('#pause-settings').addEventListener('click', () => this.openOverlay('settings'));

    this.tutorialSkip.addEventListener('click', () => this.game.skipTutorial());

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
    this.selColor.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.game.selectedPiece;
      if (!p) return;
      const def = getPieceDef(p.defId);
      if (!def.tintable) return;
      const next = (p.color + 1) % COLORS.length;
      this.game.setPieceColor(p, next, true, p.color);
      this.game.audio.ui();
      this.updateSelection();
    });
    this.selSize.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.game.selectedPiece;
      if (!p || p.defId !== 'ramp') return;
      let next = p.len * 2;
      if (next > 1920) next = 80;
      this.game.setPieceLen(p, next, true, p.len);
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

    this.tray.addEventListener('click', (e) => {
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

  refreshAll() {
    this.refreshHud();
    this.refreshTray();
    this.refreshMode();
    this.refreshSound();
    this.updateSelection();
    this.updateTutorial();
    this.refreshChallenges();
    this.refreshSettings();
  }

  refreshHud() {
    this.sparks.textContent = fmt(this.game.currency);
    this.chSparks.textContent = fmt(this.game.currency);
    this.btnUndo.disabled = !this.game.canUndo;
    this.btnRedo.disabled = !this.game.canRedo;
    this.btnClear.disabled = this.game.marbles.length === 0;
    const cap = this.game.pieces.length;
    this.capacity.classList.toggle('is-hidden', cap < 1800);
    this.capacityNum.textContent = `${cap}`;
    if (this.lastCurrency >= 0 && this.game.currency !== this.lastCurrency) {
      this.currency.classList.remove('pulse');
      void this.currency.offsetWidth;
      this.currency.classList.add('pulse');
    }
    this.lastCurrency = this.game.currency;

    const now = performance.now();
    const showCombo = this.game.comboChain > 0 && now - this.game.comboAt < 2500;
    this.combo.classList.toggle('is-hidden', !showCombo);
    if (showCombo) {
      const pct = clamp((this.game.comboChain / 80) * 100, 0, 100);
      this.comboRing.style.setProperty('--combo', `${pct}`);
      const mult = this.game.comboMultiplier;
      this.comboMult.textContent = `×${Number.isInteger(mult) ? mult : mult.toFixed(2).replace('0', '')}`;
    }
  }

  refreshMode() {
    $('#mode-build').classList.toggle('is-active', this.game.mode === 'build');
    $('#mode-play').classList.toggle('is-active', this.game.mode === 'play');
  }

  refreshSound() {
    const level = this.game.settings.sound;
    this.soundIcon.innerHTML = `<use href="#i-sound${level}"></use>`;
    this.btnSound.setAttribute('aria-label', `Sonido ${level === 0 ? 'apagado' : level === 1 ? 'bajo' : 'alto'}`);
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
        card.setAttribute('aria-label', item.label);
        const canvas = document.createElement('canvas');
        card.appendChild(canvas);
        this.tray.appendChild(card);
        drawPreview(canvas, item.id, 'piece');
      }
    }
    this.tray.scrollLeft = scroll;
  }

  tick(now: number) {
    if (now - this.lastTutorialPos > 500) {
      this.lastTutorialPos = now;
      this.updateTutorial();
    }
    this.updateSelection();
    if (this.game.comboChain > 0 && now - this.game.comboAt > 2500) {
      this.combo.classList.add('is-hidden');
    }
  }

  updateSelection() {
    const p = this.game.selectedPiece;
    if (!p || this.game.mode !== 'build' || this.game.overlayOpen) {
      this.selection.classList.add('is-hidden');
      return;
    }
    const hs = pieceHitSize(p);
    const top = this.game.worldToScreen(p.x, p.y - hs.h * 0.5 - 34 / this.game.camera.zoom);
    if (top.x < -80 || top.x > this.game.viewW + 80 || top.y < -80 || top.y > this.game.viewH + 80) {
      this.selection.classList.add('is-hidden');
      return;
    }
    this.selection.classList.remove('is-hidden');
    const isRamp = p.defId === 'ramp';
    this.selSize.classList.toggle('is-hidden', !isRamp);
    const def = getPieceDef(p.defId);
    this.selColor.classList.toggle('is-hidden', !def.tintable);
    if (def.tintable) {
      const dot = this.selColor.querySelector('span') as HTMLElement;
      dot.style.background = COLORS[p.color] ?? COLORS[0];
    }
    const count = 3 + (isRamp ? 1 : 0) + (def.tintable ? 1 : 0);
    const width = count * 52 + (count - 1) * 8;
    this.selection.style.left = `${clamp(top.x - width / 2, 8, this.game.viewW - width - 8)}px`;
    this.selection.style.top = `${clamp(top.y - 26, 64, this.game.viewH - 150)}px`;
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
    if (id === 'challenges') {
      this.challenges.classList.remove('is-hidden');
      this.refreshChallenges();
    } else if (id === 'settings') {
      this.settings.classList.remove('is-hidden');
      this.refreshSettings();
    } else if (id === 'pause') {
      this.pause.classList.remove('is-hidden');
    }
    this.game.setOverlayOpen(true);
    this.updateTutorial();
  }

  closeOverlays() {
    $$('.overlay').forEach((el) => el.classList.add('is-hidden'));
    this.game.setOverlayOpen(false);
    this.game.audio.ui();
    this.refreshAll();
  }

  // ---------------- challenges ----------------

  refreshChallenges() {
    if (this.challenges.classList.contains('is-hidden')) return;
    this.chSparks.textContent = fmt(this.game.currency);
    const scroll = this.challengeGrid.scrollTop;
    this.challengeGrid.innerHTML = '';
    for (const c of CHALLENGES) {
      const value = Math.min(c.target, this.game.challenges[c.id] ?? 0);
      const done = value >= c.target;
      const card = document.createElement('div');
      card.className = `ch-card${done ? ' done' : ''}`;
      card.setAttribute('aria-label', `${c.label}: ${value} de ${c.target}`);
      const ring = document.createElement('div');
      ring.className = 'ch-ring';
      ring.style.setProperty('--p', `${(value / c.target) * 100}`);
      const canvas = document.createElement('canvas');
      ring.appendChild(canvas);
      card.appendChild(ring);
      const num = document.createElement('div');
      num.className = 'ch-num';
      num.textContent = `${value}/${c.target}`;
      card.appendChild(num);
      const reward = document.createElement('div');
      reward.className = 'ch-reward';
      reward.innerHTML = `${icon('spark')}${fmt(c.reward)}`;
      card.appendChild(reward);
      if (done) {
        const medal = document.createElement('span');
        medal.className = 'ch-medal';
        medal.innerHTML = icon('medal');
        card.appendChild(medal);
      }
      this.challengeGrid.appendChild(card);
      drawPreview(canvas, c.preview, c.previewType);
    }
    this.challengeGrid.scrollTop = scroll;
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
    rows.push(this.buildRow('sound2', 'Sonido', this.dots(s.sound === 2 ? 3 : s.sound, 3), 'sound'));
    const q = s.quality === 'high' ? 3 : s.quality === 'low' ? 1 : 2;
    rows.push(this.buildRow('quality', 'Calidad', this.dots(q, 3, 'warn'), 'quality'));
    rows.push(this.buildRow('lefty', 'Zurdo', this.dots(s.leftHanded ? 1 : 0, 1), 'lefty'));
    rows.push(this.buildRow('motion', 'Reducir movimiento', this.dots(s.reduceMotion ? 1 : 0, 1), 'motion'));
    rows.push(this.buildRow('haptics', 'Vibración', this.dots(s.haptics && !ios ? 1 : 0, 1), 'haptics'));
    const worldDots = this.game.worlds
      .map((_, i) => {
        const color = ['#3D7EA6', '#4F9D69', '#D26D8C'][i];
        return `<button class="world-dot${this.game.activeWorld === i ? ' on' : ''}" data-world="${i}" style="--dot:${color}" aria-label="Mundo ${i + 1}"></button>`;
      })
      .join('');
    rows.push(`<div class="set-row">
      <div class="set-ic">${icon('world')}</div>
      <div class="set-label">Mundos</div>
      <div class="set-value world-dots">${worldDots}</div>
    </div>`);
    rows.push(this.buildRow('play', 'Repetir tutorial', '', 'tutorial'));
    rows.push(this.buildRow('trash', 'Borrar canvas', '', 'clear', 'reset-row'));
    rows.push(`<div class="set-row" style="justify-content:center;border:0;background:transparent;min-height:40px;padding:2px"><span class="tiny">Marblelous v1.1.1 · sin datos · sin red</span></div>`);
    this.settingsBody.innerHTML = rows.join('');

    this.settingsBody.querySelectorAll<HTMLElement>('.set-row.tap').forEach((row) => {
      const action = row.dataset.action ?? '';
      row.addEventListener('click', () => {
        if (action === 'sound') this.game.cycleSound();
        else if (action === 'quality') this.game.cycleQuality();
        else if (action === 'lefty') this.game.toggleLefty();
        else if (action === 'motion') this.game.toggleReduceMotion();
        else if (action === 'haptics') this.game.toggleHaptics();
        else if (action === 'tutorial') {
          this.game.restartTutorial();
          this.closeOverlays();
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
        this.closeOverlays();
      });
    });
  }

  // ---------------- tutorial ----------------

  updateTutorial() {
    const show = !this.game.settings.tutorialSeen && this.game.tutorialStep < 4 && !this.game.overlayOpen;
    this.tutorial.classList.toggle('is-hidden', !show);
    if (!show) {
      $$('.tut-target').forEach((el) => el.classList.remove('tut-target'));
      return;
    }
    const hand = this.tutorial.querySelector('.hand') as HTMLElement;
    let target: HTMLElement | null = null;
    if (this.game.tutorialStep === 0) {
      target = (this.tray.querySelector('.card[data-id="brick2"]') as HTMLElement) ?? this.tray;
    } else if (this.game.tutorialStep === 2) {
      target = $('#mode-play') as HTMLElement;
    }
    if (this.game.tutorialStep === 1 || this.game.tutorialStep === 3) {
      $$('.tut-target').forEach((el) => el.classList.remove('tut-target'));
      const world = this.game.tutorialStep === 1
        ? { x: this.game.camera.x - 150, y: this.game.camera.y - 40 }
        : { x: this.game.camera.x, y: this.game.camera.y - 160 };
      const s = this.game.worldToScreen(world.x, world.y);
      hand.style.left = `${clamp(s.x - 32, 8, window.innerWidth - 72)}px`;
      hand.style.top = `${clamp(s.y - 40, 60, window.innerHeight - 90)}px`;
      return;
    }
    $$('.tut-target').forEach((el) => {
      if (el !== target) el.classList.remove('tut-target');
    });
    if (!target) return;
    target.classList.add('tut-target');
    const r = target.getBoundingClientRect();
    const isTrayCard = target.classList.contains('card');
    const left = isTrayCard ? r.right + 4 : r.left + r.width / 2 - 32;
    const top = isTrayCard ? r.top - 54 : r.top - 58;
    hand.style.left = `${clamp(left, 8, window.innerWidth - 72)}px`;
    hand.style.top = `${clamp(top, 60, window.innerHeight - 90)}px`;
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
      <div class="s-item loop">${icon('loop')}${s.loops}</div>
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
    if (this.game.settings.reduceMotion) return;
    this.flashEl.style.opacity = `${alpha}`;
    this.flashEl.classList.add('on');
    window.setTimeout(() => {
      this.flashEl.classList.remove('on');
      this.flashEl.style.opacity = '';
    }, 70);
  }
}
