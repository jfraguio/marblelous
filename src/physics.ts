import type { Collider, Marble, PhysEvent, Piece, Trigger } from './types';
import { SPIRAL_DURATION, SPIRAL_ENTRY, buildPiece, pieceHitSize, spiralDepth, spiralLocal } from './pieces';
import { clamp, TAU } from './util';

const CELL = 64;
const TRIGGER_CELL = 128;
const MARBLE_CELL = 72;
const MAX_SPEED = 3400;
const GRAVITY = 1800;
const SLOP = 0.5;
const BUBBLE_RISE = -190;
const BUBBLE_LIFE = 8;
const TRIGGER_PAD = 40;

interface SpiralInfo {
  pieceId: number;
  x: number;
  y: number;
  rot: number;
}

function cellKey(cx: number, cy: number) {
  return (cx + 4096) * 8192 + (cy + 4096);
}

function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 0.000001) return { x: ax, y: ay };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * t, y: ay + dy * t };
}

export class PhysicsWorld {
  colliders: Collider[] = [];
  /** Colliders que cambian de ángulo en cada paso (balancines). */
  dynamicColliders: Collider[] = [];
  triggers: Trigger[] = [];
  spirals: SpiralInfo[] = [];
  events: PhysEvent[] = [];
  private grid = new Map<number, number[]>();
  private triggerGrid = new Map<number, number[]>();
  private triggerQuery: Trigger[] = [];
  private marbleGrid = new Map<number, number[]>();
  private marbleCells: number[] = [];
  private marblePool: number[][] = [];
  private disabled = new Map<number, number>();
  private visited = new Uint32Array(0);
  private stamp = 0;

  rebuild(pieces: Piece[]) {
    const disabled = new Map<string, number>();
    for (const t of this.triggers) {
      const key = `${t.kind}:${t.pieceId}`;
      disabled.set(key, Math.max(disabled.get(key) ?? 0, t.disabledUntil));
    }
    this.colliders = [];
    this.dynamicColliders = [];
    this.triggers = [];
    this.spirals = [];
    for (const p of pieces) {
      const built = buildPiece(p);
      const target = p.defId === 'balance' ? this.dynamicColliders : this.colliders;
      for (const c of built.colliders) target.push(c);
      for (const t of built.triggers) {
        const prev = disabled.get(`${t.kind}:${t.pieceId}`) ?? 0;
        if (prev > t.disabledUntil) t.disabledUntil = prev;
        this.triggers.push(t);
      }
      if (p.defId === 'spiral') {
        this.spirals.push({ pieceId: p.id, x: p.x, y: p.y, rot: p.rot });
      }
    }
    this.grid.clear();
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const minX = Math.min(c.ax, c.bx) - c.r;
      const maxX = Math.max(c.ax, c.bx) + c.r;
      const minY = Math.min(c.ay, c.by) - c.r;
      const maxY = Math.max(c.ay, c.by) + c.r;
      const x0 = Math.floor(minX / CELL);
      const x1 = Math.floor(maxX / CELL);
      const y0 = Math.floor(minY / CELL);
      const y1 = Math.floor(maxY / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          let arr = this.grid.get(key);
          if (!arr) {
            arr = [];
            this.grid.set(key, arr);
          }
          arr.push(i);
        }
      }
    }
    if (this.visited.length < this.colliders.length) {
      this.visited = new Uint32Array(Math.max(64, this.colliders.length + 128));
    }
    this.triggerGrid.clear();
    for (let i = 0; i < this.triggers.length; i++) {
      const t = this.triggers[i];
      const reach =
        (t.w > 0 || t.h > 0 ? Math.hypot(t.w / 2, t.h / 2) : t.r) + TRIGGER_PAD;
      const x0 = Math.floor((t.x - reach) / TRIGGER_CELL);
      const x1 = Math.floor((t.x + reach) / TRIGGER_CELL);
      const y0 = Math.floor((t.y - reach) / TRIGGER_CELL);
      const y1 = Math.floor((t.y + reach) / TRIGGER_CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          let arr = this.triggerGrid.get(key);
          if (!arr) {
            arr = [];
            this.triggerGrid.set(key, arr);
          }
          arr.push(i);
        }
      }
    }
    this.stamp = 0;
  }

  /** Recalcula solo las barras móviles, sin rehacer toda la rejilla. */
  syncBalances(pieces: Piece[]) {
    this.dynamicColliders = [];
    for (const p of pieces) {
      if (p.defId !== 'balance') continue;
      const built = buildPiece(p);
      for (const c of built.colliders) this.dynamicColliders.push(c);
    }
  }

  clearEvents() {
    this.events.length = 0;
  }

  setPieceDisabled(id: number, until: number) {
    this.disabled.set(id, until);
  }

  clearDisabled() {
    this.disabled.clear();
  }

  /** Triggers cuya caja puede contener a la canica (consulta de una celda). */
  private nearbyTriggers(m: Marble): Trigger[] {
    const out = this.triggerQuery;
    out.length = 0;
    if (this.triggers.length === 0) return out;
    const arr = this.triggerGrid.get(
      cellKey(Math.floor(m.x / TRIGGER_CELL), Math.floor(m.y / TRIGGER_CELL))
    );
    if (!arr) return out;
    for (let i = 0; i < arr.length; i++) out.push(this.triggers[arr[i]]);
    return out;
  }

  update(marbles: Marble[], dt: number, now: number) {
    for (const m of marbles) {
      if (m.alive) this.stepMarble(m, dt, now);
    }
    this.resolveMarbles(marbles, now);
  }

  private stepMarble(m: Marble, dt: number, now: number) {
    if (m.bubbled) {
      this.stepBubble(m, dt, now);
      return;
    }
    if (m.ridePiece) {
      this.stepRide(m, dt);
      return;
    }
    if (!m.awake) return;
    m.px = m.x;
    m.py = m.y;
    const speed = Math.hypot(m.vx, m.vy);
    const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / (m.r * 0.8))));
    const h = dt / steps;
    m.contact = 0;

    for (let step = 0; step < steps; step++) {
      m.vy += GRAVITY * h;
      if (this.triggers.length > 0) this.applyFields(m, h, now);
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        m.vx *= k;
        m.vy *= k;
      }
      m.x += m.vx * h;
      m.y += m.vy * h;
      this.resolveStatic(m, h, now);
    }

    if (m.contact) {
      if (m.airTime > 1.2) {
        this.events.push({
          type: 'air',
          x: m.x,
          y: m.y,
          pieceId: 0,
          note: -1,
          impact: m.airTime * 1000,
          marbleId: m.id,
          speed: Math.hypot(m.vx, m.vy)
        });
      }
      m.airTime = 0;
      const damp = Math.exp(-m.roll * dt * 0.55);
      m.vx *= damp;
      m.vy *= damp;
    } else {
      m.airTime += dt;
    }

    if (this.triggers.length > 0) this.checkTriggers(m, now);

    const sp2 = Math.hypot(m.vx, m.vy);
    if (sp2 < 22 && m.contact) {
      m.sleepTimer += dt;
      if (m.sleepTimer > 0.6) {
        m.awake = false;
        m.vx = 0;
        m.vy = 0;
      }
    } else {
      m.sleepTimer = 0;
    }
  }

  private stepRide(m: Marble, dt: number) {
    const piece = this.spirals.find((p) => p.pieceId === m.ridePiece);
    if (!piece) {
      m.ridePiece = 0;
      m.rideScale = 1;
      m.rideDepth = 0;
      m.vy = 260;
      m.awake = true;
      return;
    }
    m.rideT += dt / SPIRAL_DURATION;
    const t = Math.min(1, m.rideT);
    const local = spiralLocal(t);
    const c = Math.cos(piece.rot);
    const s = Math.sin(piece.rot);
    m.px = m.x;
    m.py = m.y;
    m.x = piece.x + local.x * c - local.y * s;
    m.y = piece.y + local.x * s + local.y * c;
    m.vx = 0;
    m.vy = 0;
    m.contact = 0;
    m.airTime = 0;
    m.sleepTimer = 0;
    m.rideDepth = spiralDepth(t);
    m.rideScale = 1 + m.rideDepth * 0.1;
    const slot = Math.min(7, Math.floor(t * 8));
    if (slot > m.rideNextChime) {
      m.rideNextChime = slot;
      this.events.push({
        type: 'chime',
        x: m.x,
        y: m.y,
        pieceId: m.ridePiece,
        note: slot,
        impact: 260,
        marbleId: m.id,
        speed: 0
      });
    }
    if (m.rideT >= 1) {
      const end = spiralLocal(1);
      m.x = piece.x + end.x * c - end.y * s;
      m.y = piece.y + end.x * s + end.y * c;
      m.px = m.x;
      m.py = m.y;
      m.ridePiece = 0;
      m.rideScale = 1;
      m.rideDepth = 0;
      m.vx = 90 * c - 300 * s;
      m.vy = 90 * s + 300 * c;
      m.awake = true;
      m.contact = 0;
      m.airTime = 0;
      m.sleepTimer = 0;
    }
  }

  private stepBubble(m: Marble, dt: number, now: number) {
    m.px = m.x;
    m.py = m.y;
    m.bubbleT += dt;
    m.vy += (BUBBLE_RISE - m.vy) * Math.min(1, dt * 3.2);
    m.vx *= Math.exp(-dt * 1.2);
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.contact = 0;
    m.airTime = 0;
    m.sleepTimer = 0;
    m.awake = true;
    if (this.triggers.length > 0) this.applyFields(m, dt, now);
    if (this.triggers.length > 0) this.checkTriggers(m, now);
    if (m.bubbled && m.bubbleT > 0.3 && this.bubbleTouchesSolid(m)) this.popBubble(m);
    if (m.bubbled && m.bubbleT > BUBBLE_LIFE) this.popBubble(m);
  }

  private bubbleTouchesSolid(m: Marble): boolean {
    const bubbleR = m.r * 1.55;
    for (const list of [this.colliders, this.dynamicColliders]) {
      for (const c of list) {
        const p = closestOnSegment(m.x, m.y, c.ax, c.ay, c.bx, c.by);
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        const rr = c.r + bubbleR;
        if (dx * dx + dy * dy <= rr * rr) return true;
      }
    }
    return false;
  }

  private popBubble(m: Marble) {
    if (!m.bubbled) return;
    m.bubbled = false;
    m.bubbleT = 0;
    m.bubbleReadyAt = performance.now() + 1200;
    m.vy = Math.max(60, m.vy * 0.2);
    m.vx *= 0.7;
    m.awake = true;
    m.contact = 0;
    m.airTime = 0;
    this.events.push({
      type: 'pop',
      x: m.x,
      y: m.y,
      pieceId: 0,
      note: -1,
      impact: 0,
      marbleId: m.id,
      speed: Math.hypot(m.vx, m.vy)
    });
  }

  private applyFields(m: Marble, h: number, now: number) {
    const triggers = this.nearbyTriggers(m);
    for (let ti = 0; ti < triggers.length; ti++) {
      const t = triggers[ti];
      if (m.bubbled) {
        if (t.kind === 'fan' && this.inTriggerRect(m, t)) {
          m.vx += t.dx * t.power * h * 0.45;
          m.vy += t.dy * t.power * h * 0.45;
          const sp = Math.hypot(m.vx, m.vy);
          if (sp > 950) {
            const k = 950 / sp;
            m.vx *= k;
            m.vy *= k;
          }
        }
        continue;
      }
      if (t.kind === 'boost') {
        if (!this.inTriggerRect(m, t)) continue;
        m.vx += t.dx * t.power * h;
        m.vy += t.dy * t.power * h;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > 3300) {
          const k = 3300 / sp;
          m.vx *= k;
          m.vy *= k;
        }
        if (now - m.lastBoost > 500 || m.lastBoostPiece !== t.pieceId) {
          m.lastBoost = now;
          m.lastBoostPiece = t.pieceId;
          this.events.push({
            type: 'boost',
            x: m.x,
            y: m.y,
            pieceId: t.pieceId,
            note: -1,
            impact: 0,
            marbleId: m.id,
            speed: sp
          });
        }
      } else if (t.kind === 'fan') {
        if (!this.inTriggerRect(m, t)) continue;
        m.vx += t.dx * t.power * h;
        m.vy += t.dy * t.power * h;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > 3300) {
          const k = 3300 / sp;
          m.vx *= k;
          m.vy *= k;
        }
      } else if (t.kind === 'magnet') {
        const dx = t.x - m.x;
        const dy = t.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d > t.r || d < 0.001) continue;
        // El acero responde mucho más que el resto de canicas.
        const metal = m.typeId === 'steel' ? 1 : m.typeId === 'plasma' ? 0.65 : 0.22;
        const falloff = 1 - (d / t.r) * 0.55;
        const force = t.power * metal * falloff;
        m.vx += (dx / d) * force * h;
        m.vy += (dy / d) * force * h;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > 3300) {
          const k = 3300 / sp;
          m.vx *= k;
          m.vy *= k;
        }
      }
    }
  }

  private checkTriggers(m: Marble, now: number) {
    if (m.bubbled) return;
    const triggers = this.nearbyTriggers(m);
    for (let ti = 0; ti < triggers.length; ti++) {
      const t = triggers[ti];
      if (t.disabledUntil > now) continue;
      if (t.kind === 'goal') {
        if (this.inTriggerRect(m, t) || this.inTriggerCircle(m, t)) {
          this.events.push({
            type: 'goal',
            x: m.x,
            y: m.y,
            pieceId: t.pieceId,
            note: -1,
            impact: 0,
            marbleId: m.id,
            speed: Math.hypot(m.vx, m.vy)
          });
          m.alive = false;
          return;
        }
      } else if (t.kind === 'star') {
        if (this.inTriggerCircle(m, t)) {
          this.events.push({
            type: 'star',
            x: m.x,
            y: m.y,
            pieceId: t.pieceId,
            note: -1,
            impact: 0,
            marbleId: m.id,
            speed: Math.hypot(m.vx, m.vy)
          });
          t.disabledUntil = now + 5000;
          return;
        }
      } else if (t.kind === 'bubbleLift') {
        if (now < m.bubbleReadyAt) continue;
        if (!this.inTriggerCircle(m, t)) continue;
        m.bubbled = true;
        m.bubbleT = 0;
        m.vx *= 0.25;
        m.vy = -40;
        m.contact = 0;
        m.airTime = 0;
        m.sleepTimer = 0;
        m.awake = true;
        this.events.push({
          type: 'bubble',
          x: m.x,
          y: m.y,
          pieceId: t.pieceId,
          note: -1,
          impact: 0,
          marbleId: m.id,
          speed: Math.hypot(m.vx, m.vy)
        });
        return;
      } else if (t.kind === 'spiral') {
        if (m.ridePiece) continue;
        if (!this.inTriggerCircle(m, t)) continue;
        if (m.vy < -60) continue;
        const piece = this.spirals.find((x) => x.pieceId === t.pieceId);
        if (!piece) continue;
        m.ridePiece = t.pieceId;
        m.rideT = 0;
        m.rideNextChime = 0;
        m.rideScale = 1;
        m.rideDepth = 0;
        m.vx = 0;
        m.vy = 0;
        m.awake = true;
        m.sleepTimer = 0;
        m.contact = 0;
        m.airTime = 0;
        const c = Math.cos(piece.rot);
        const s = Math.sin(piece.rot);
        m.x = piece.x + SPIRAL_ENTRY.x * c - SPIRAL_ENTRY.y * s;
        m.y = piece.y + SPIRAL_ENTRY.x * s + SPIRAL_ENTRY.y * c;
        m.px = m.x;
        m.py = m.y;
        this.events.push({
          type: 'spiral',
          x: m.x,
          y: m.y,
          pieceId: t.pieceId,
          note: -1,
          impact: 0,
          marbleId: m.id,
          speed: 0
        });
        return;
      } else if (t.kind === 'hourglass') {
        if (!this.inTriggerCircle(m, t)) continue;
        t.disabledUntil = now + 10000;
        this.events.push({
          type: 'hourglass',
          x: t.x,
          y: t.y,
          pieceId: t.pieceId,
          note: -1,
          impact: 0,
          marbleId: m.id,
          speed: Math.hypot(m.vx, m.vy)
        });
        return;
      } else if (t.kind === 'cannon') {
        if (!this.inTriggerRect(m, t)) continue;
        if (now - m.lastCannon <= 300 && m.lastCannonPiece === t.pieceId) continue;
        m.vx += t.dx * t.power;
        m.vy += t.dy * t.power;
        m.lastCannon = now;
        m.lastCannonPiece = t.pieceId;
        m.awake = true;
        m.sleepTimer = 0;
        m.contact = 0;
        m.airTime = 0;
        this.events.push({
          type: 'cannon',
          x: m.x,
          y: m.y,
          pieceId: t.pieceId,
          note: -1,
          impact: t.power,
          marbleId: m.id,
          speed: Math.hypot(m.vx, m.vy)
        });
        return;
      } else if (t.kind === 'portal') {
        if (!this.inTriggerCircle(m, t)) continue;
        if (now - m.lastPortalAt < 350) continue;
        const partner = this.triggers.find((x) => x !== t && x.kind === 'portal' && x.pairId === t.pairId);
        if (!partner) continue;
        const sp = Math.hypot(m.vx, m.vy);
        let nx = sp > 1 ? m.vx / sp : 1;
        let ny = sp > 1 ? m.vy / sp : 0;
        m.x = partner.x + nx * 46;
        m.y = partner.y + ny * 46;
        m.px = m.x;
        m.py = m.y;
        m.lastPortalAt = now;
        m.lastPortalPiece = t.pieceId;
        this.events.push({
          type: 'portal',
          x: partner.x,
          y: partner.y,
          pieceId: t.pieceId,
          note: -1,
          impact: 0,
          marbleId: m.id,
          speed: sp
        });
        return;
      }
    }
  }

  private inTriggerRect(m: Marble, t: Trigger): boolean {
    if (t.w <= 0 || t.h <= 0) return false;
    const dx = m.x - t.x;
    const dy = m.y - t.y;
    const c = Math.cos(-t.rot);
    const s = Math.sin(-t.rot);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    return Math.abs(lx) <= t.w / 2 + m.r * 0.35 && Math.abs(ly) <= t.h / 2 + m.r * 0.35;
  }

  private inTriggerCircle(m: Marble, t: Trigger): boolean {
    if (t.r <= 0) return false;
    const dx = m.x - t.x;
    const dy = m.y - t.y;
    return dx * dx + dy * dy <= (t.r + m.r * 0.3) * (t.r + m.r * 0.3);
  }

  private resolveStatic(m: Marble, dt: number, now: number) {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.visited.fill(0);
      this.stamp = 1;
    }
    const st = this.stamp;
    const r = m.r + 18;
    const x0 = Math.floor((m.x - r) / CELL);
    const x1 = Math.floor((m.x + r) / CELL);
    const y0 = Math.floor((m.y - r) / CELL);
    const y1 = Math.floor((m.y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.grid.get(cellKey(cx, cy));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const idx = arr[k];
          if (this.visited[idx] === st) continue;
          this.visited[idx] = st;
          this.collideStatic(m, this.colliders[idx], dt, now);
        }
      }
    }
    // Los balancines cambian de ángulo cada paso y quedan fuera de la rejilla.
    for (const c of this.dynamicColliders) {
      const minX = Math.min(c.ax, c.bx) - c.r;
      const maxX = Math.max(c.ax, c.bx) + c.r;
      const minY = Math.min(c.ay, c.by) - c.r;
      const maxY = Math.max(c.ay, c.by) + c.r;
      if (m.x + m.r < minX || m.x - m.r > maxX || m.y + m.r < minY || m.y - m.r > maxY) continue;
      this.collideStatic(m, c, dt, now);
    }
  }

  private collideStatic(m: Marble, c: Collider, dt: number, now: number) {
    if ((this.disabled.get(c.pieceId) ?? 0) > now) return;
    const p = closestOnSegment(m.x, m.y, c.ax, c.ay, c.bx, c.by);
    let nx = m.x - p.x;
    let ny = m.y - p.y;
    const d = Math.hypot(nx, ny);
    const min = m.r + c.r;
    if (d >= min) return;

    if (d < 0.0001) {
      const dx = c.bx - c.ax;
      const dy = c.by - c.ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.0001) {
        nx = 0;
        ny = -1;
      } else {
        nx = -dy / len;
        ny = dx / len;
      }
    } else {
      nx /= d;
      ny /= d;
    }

    const pen = min - d;
    if (pen > SLOP) {
      m.x += nx * (pen - SLOP) * 0.9;
      m.y += ny * (pen - SLOP) * 0.9;
    }

    m.contact = 1;
    const vn = m.vx * nx + m.vy * ny;
    if (vn >= 0) return;

    const impact = -vn;
    if (c.cannon && impact > 40) {
      if (now - m.lastCannon > 300 || m.lastCannonPiece !== c.pieceId) {
        m.vx += c.ux * 1800;
        m.vy += c.uy * 1800;
        m.lastCannon = now;
        m.lastCannonPiece = c.pieceId;
        this.events.push({
          type: 'cannon',
          x: m.x,
          y: m.y,
          pieceId: c.pieceId,
          note: -1,
          impact,
          marbleId: m.id,
          speed: Math.hypot(m.vx, m.vy)
        });
      }
    }

    const e = impact > 80 ? clamp(c.e * (m.e / 0.45), 0, 0.95) : 0;
    m.vx -= nx * (1 + e) * vn;
    m.vy -= ny * (1 + e) * vn;

    if (impact > 80) {
      let tvx = m.vx - nx * (m.vx * nx + m.vy * ny);
      let tvy = m.vy - ny * (m.vx * nx + m.vy * ny);
      const tv = Math.hypot(tvx, tvy);
      if (tv > 0.001) {
        const maxF = c.mu * (1 + e) * impact;
        const amt = Math.min(tv, maxF);
        tvx = (tvx / tv) * amt;
        tvy = (tvy / tv) * amt;
        m.vx -= tvx;
        m.vy -= tvy;
      }
    }

    if (c.conveyor > 0 && c.tx * c.tx + c.ty * c.ty > 0.1) {
      const vt = m.vx * c.tx + m.vy * c.ty;
      const delta = clamp(c.conveyor - vt, -900 * dt, 900 * dt);
      m.vx += c.tx * delta;
      m.vy += c.ty * delta;
    }

    if (c.chime && impact > 54) {
      this.events.push({
        type: 'chime',
        x: m.x,
        y: m.y,
        pieceId: c.pieceId,
        note: c.note,
        impact,
        marbleId: m.id,
        speed: Math.hypot(m.vx, m.vy)
      });
    }
    if (c.bumper && impact > 55) {
      this.events.push({
        type: 'bumper',
        x: m.x,
        y: m.y,
        pieceId: c.pieceId,
        note: -1,
        impact,
        marbleId: m.id,
        speed: Math.hypot(m.vx, m.vy)
      });
    }
  }

  private collideMarblePair(a: Marble, b: Marble, now: number): boolean {
    if (!a.alive || !b.alive || a.bubbled || b.bubbled) return false;
    if (!a.awake && !b.awake) return true;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const min = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return true;
    let d = Math.sqrt(d2);
    if (d < 0.0001) {
      dx = 0.01;
      dy = 0;
      d = 0.01;
    }
    const nx = dx / d;
    const ny = dy / d;
    const pen = min - d;
    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return true;
    a.x -= nx * pen * (a.invMass / invSum) * 0.85;
    a.y -= ny * pen * (a.invMass / invSum) * 0.85;
    b.x += nx * pen * (b.invMass / invSum) * 0.85;
    b.y += ny * pen * (b.invMass / invSum) * 0.85;
    if (!a.awake) {
      a.awake = true;
      a.sleepTimer = 0;
    }
    if (!b.awake) {
      b.awake = true;
      b.sleepTimer = 0;
    }
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = Math.min(a.e, b.e);
      const jimp = (-(1 + e) * vn) / invSum;
      a.vx -= nx * jimp * a.invMass;
      a.vy -= ny * jimp * a.invMass;
      b.vx += nx * jimp * b.invMass;
      b.vy += ny * jimp * b.invMass;
      const tvx = rvx - nx * vn;
      const tvy = rvy - ny * vn;
      const tv = Math.hypot(tvx, tvy);
      if (tv > 0.01) {
        const f = Math.min(tv, 0.08 * Math.abs(vn));
        a.vx += (tvx / tv) * f * 0.5;
        a.vy += (tvy / tv) * f * 0.5;
        b.vx -= (tvx / tv) * f * 0.5;
        b.vy -= (tvy / tv) * f * 0.5;
      }
      if (-vn > 80) {
        this.events.push({
          type: 'marble',
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          pieceId: 0,
          note: -1,
          impact: -vn,
          marbleId: a.id,
          speed: Math.hypot(rvx, rvy)
        });
      }
    }
    if (a.typeId === 'rainbow' || b.typeId === 'rainbow') {
      const rolls: Array<[Marble, Marble]> = [];
      if (a.typeId === 'rainbow') rolls.push([a, b]);
      if (b.typeId === 'rainbow') rolls.push([b, a]);
      for (const [src, dst] of rolls) {
        if (!src.alive || !dst.alive) continue;
        if (now - src.lastRainbowAt < 400) continue;
        src.lastRainbowAt = now;
        if (Math.random() >= 0.1) continue;
        // La arcoíris hace estallar a la otra canica (de cualquier tipo).
        dst.alive = false;
        this.events.push({
          type: 'rainbow',
          x: dst.x,
          y: dst.y,
          pieceId: 0,
          note: -1,
          impact: 0,
          marbleId: dst.id,
          speed: Math.hypot(a.vx - b.vx, a.vy - b.vy)
        });
        break;
      }
      if (!a.alive || !b.alive) return false;
    }
    return true;
  }

  /** Rejilla de canicas reutilizada para evitar el O(n²) en lotes grandes. */
  private rebuildMarbleGrid(marbles: Marble[]) {
    const pool = this.marblePool;
    for (let i = 0; i < this.marbleCells.length; i++) {
      const key = this.marbleCells[i];
      const arr = this.marbleGrid.get(key);
      if (!arr) continue;
      arr.length = 0;
      this.marbleGrid.delete(key);
      pool.push(arr);
    }
    this.marbleCells.length = 0;
    for (let i = 0; i < marbles.length; i++) {
      const m = marbles[i];
      if (!m.alive || m.bubbled) continue;
      const key = cellKey(Math.floor(m.x / MARBLE_CELL), Math.floor(m.y / MARBLE_CELL));
      let arr = this.marbleGrid.get(key);
      if (!arr) {
        arr = pool.pop() ?? [];
        this.marbleGrid.set(key, arr);
        this.marbleCells.push(key);
      }
      arr.push(i);
    }
  }

  private resolveMarbles(marbles: Marble[], now: number) {
    const n = marbles.length;
    if (n < 32) {
      for (let i = 0; i < n; i++) {
        const a = marbles[i];
        if (!a.alive || a.bubbled) continue;
        for (let j = i + 1; j < n; j++) {
          const b = marbles[j];
          if (!b.alive || b.bubbled) continue;
          if (!this.collideMarblePair(a, b, now)) break;
        }
      }
      return;
    }
    this.rebuildMarbleGrid(marbles);
    for (let i = 0; i < n; i++) {
      const a = marbles[i];
      if (!a.alive || a.bubbled) continue;
      const cx = Math.floor(a.x / MARBLE_CELL);
      const cy = Math.floor(a.y / MARBLE_CELL);
      let stop = false;
      for (let ox = -1; ox <= 1 && !stop; ox++) {
        for (let oy = -1; oy <= 1 && !stop; oy++) {
          const arr = this.marbleGrid.get(cellKey(cx + ox, cy + oy));
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const b = marbles[arr[k]];
            // Solo procesamos cada pareja una vez y en una sola dirección.
            if (b.id <= a.id) continue;
            if (!b.alive || b.bubbled) continue;
            if (!this.collideMarblePair(a, b, now)) {
              stop = true;
              break;
            }
          }
        }
      }
    }
  }

}

export function contentBounds(pieces: Piece[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (pieces.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pieces) {
    const hs = pieceHitSize(p);
    const r = Math.max(hs.w, hs.h) / 2 + 30;
    minX = Math.min(minX, p.x - r);
    minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r);
    maxY = Math.max(maxY, p.y + r);
  }
  return { minX, minY, maxX, maxY };
}

export function createMarble(
  id: number,
  type: { id: string; r: number; density: number; e: number; mu: number; roll: number },
  x: number,
  y: number,
  dropId: number,
  now: number
): Marble {
  const mass = (type.r / 9) * (type.r / 9) * type.density;
  return {
    id,
    typeId: type.id,
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    r: type.r,
    mass,
    invMass: 1 / mass,
    e: type.e,
    mu: type.mu,
    roll: type.roll,
    spin: 0,
    awake: true,
    sleepTimer: 0,
    contact: 0,
    airTime: 0,
    bornAt: now,
    dropId,
    alive: true,
    trail: [],
    trailAcc: 0,
    lastCannon: -1000,
    lastCannonPiece: 0,
    lastBoost: -1000,
    lastBoostPiece: 0,
    lastPortalAt: -1000,
    lastPortalPiece: 0,
    lastRainbowAt: -1000,
    ridePiece: 0,
    rideT: 0,
    rideNextChime: 0,
    rideScale: 1,
    rideDepth: 0,
    bubbled: false,
    bubbleT: 0,
    bubbleReadyAt: 0
  };
}

export { TAU } from './util';
