import type { Collider, Marble, PhysEvent, Piece, Trigger } from './types';
import { LOOP_RADIUS, SPIRAL_DURATION, SPIRAL_ENTRY, buildPiece, getPieceDef, spiralDepth, spiralLocal } from './pieces';
import { clamp, shortAngle, TAU } from './util';

const CELL = 64;
const MAX_SPEED = 3400;
const GRAVITY = 1800;
const SLOP = 0.5;

interface LoopInfo {
  pieceId: number;
  x: number;
  y: number;
  r: number;
}

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
  triggers: Trigger[] = [];
  loops: LoopInfo[] = [];
  spirals: SpiralInfo[] = [];
  events: PhysEvent[] = [];
  private grid = new Map<number, number[]>();
  private disabled = new Map<number, number>();
  private visited = new Uint32Array(0);
  private stamp = 0;

  rebuild(pieces: Piece[]) {
    this.colliders = [];
    this.triggers = [];
    this.loops = [];
    this.spirals = [];
    for (const p of pieces) {
      const built = buildPiece(p);
      for (const c of built.colliders) this.colliders.push(c);
      for (const t of built.triggers) this.triggers.push(t);
      if (p.defId === 'loop') {
        this.loops.push({ pieceId: p.id, x: p.x, y: p.y, r: LOOP_RADIUS });
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
    this.stamp = 0;
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

  update(marbles: Marble[], dt: number, now: number) {
    for (const m of marbles) {
      if (m.alive) this.stepMarble(m, dt, now);
    }
    this.resolveMarbles(marbles);
    this.updateLoops(marbles, dt);
  }

  private stepMarble(m: Marble, dt: number, now: number) {
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
      this.applyFields(m, h, now);
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

    this.checkTriggers(m, now);

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

  private applyFields(m: Marble, h: number, now: number) {
    for (const t of this.triggers) {
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
        if (d > 4 && d < t.r) {
          const force = (t.power * (1 - d / t.r)) / d;
          m.vx += dx * force * h;
          m.vy += dy * force * h;
        }
      }
    }
  }

  private checkTriggers(m: Marble, now: number) {
    for (const t of this.triggers) {
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
  }

  private collideStatic(m: Marble, c: Collider, dt: number, now: number) {
    if (c.bubble && (this.disabled.get(c.pieceId) ?? 0) > now) return;
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
    } else if (c.mat === 'rubber' && !c.bubble && impact > 90) {
      this.events.push({
        type: 'trampoline',
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

  private resolveMarbles(marbles: Marble[]) {
    const n = marbles.length;
    for (let i = 0; i < n; i++) {
      const a = marbles[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = marbles[j];
        if (!b.alive) continue;
        if (!a.awake && !b.awake) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
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
        if (invSum <= 0) continue;
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
      }
    }
  }

  private updateLoops(marbles: Marble[], dt: number) {
    if (this.loops.length === 0) return;
    for (const m of marbles) {
      if (!m.alive || !m.awake) continue;
      for (const loop of this.loops) {
        const dx = m.x - loop.x;
        const dy = m.y - loop.y;
        const d = Math.hypot(dx, dy);
        const inner = loop.r - 38;
        const outer = loop.r + 32;
        let entry = m.loopData.get(loop.pieceId);
        const speed = Math.hypot(m.vx, m.vy);

        // Asistencia de entrada: una canica que llega por la boca inferior
        // recibe una pequeña guía tangencial. Hace el bucle fiable y legible.
        if (
          (!entry || entry.out > 0.3) &&
          dy > 0 &&
          Math.abs(dx) < loop.r * 0.92 &&
          d > 34 &&
          d < 108 &&
          m.vy > -60 &&
          speed < 1700
        ) {
          const a = Math.PI / 3;
          m.x = loop.x + Math.cos(a) * (loop.r - 14);
          m.y = loop.y + Math.sin(a) * (loop.r - 14);
          m.px = m.x;
          m.py = m.y;
          const tx = Math.sin(a);
          const ty = -Math.cos(a);
          const sp = Math.max(1200, speed * 0.96);
          m.vx = tx * sp;
          m.vy = ty * sp;
          entry = { last: a, total: 0, awarded: false, out: 0 };
          m.loopData.set(loop.pieceId, entry);
          continue;
        }

        if (d < inner || d > outer) {
          if (entry) {
            entry.out += dt;
            if (entry.out > 1.0) {
              entry.last = 0;
              entry.total = 0;
              entry.awarded = false;
              entry.out = 0;
            }
          }
          continue;
        }
        const ang = Math.atan2(dy, dx);
        if (!entry) {
          entry = { last: ang, total: 0, awarded: false, out: 0 };
          m.loopData.set(loop.pieceId, entry);
        } else {
          const delta = shortAngle(ang - entry.last);
          entry.total += delta;
          entry.last = ang;
          entry.out = 0;
        }
        if (!entry.awarded && Math.abs(entry.total) > 5.2) {
          entry.awarded = true;
          this.events.push({
            type: 'loop',
            x: m.x,
            y: m.y,
            pieceId: loop.pieceId,
            note: -1,
            impact: 0,
            marbleId: m.id,
            speed: Math.hypot(m.vx, m.vy)
          });
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
    const d = getPieceDef(p.defId);
    const r = Math.max(d.w, d.h) / 2 + 30;
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
    ridePiece: 0,
    rideT: 0,
    rideNextChime: 0,
    rideScale: 1,
    rideDepth: 0,
    loopData: new Map()
  };
}

export { TAU } from './util';
