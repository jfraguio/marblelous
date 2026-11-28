import type { Collider, Marble, PhysEvent, Piece, Trigger } from './types';
import {
  FAN_HALF, FAN_INTAKE_BOTTOM, FAN_INTAKE_TOP, FAN_OUTLET, FUNNEL_LEFT,
  CHANNEL_ENTRY, CHANNEL_EXIT, SPLITTER_EXIT_X,
  SPIRAL_DURATION, SPIRAL_ENTRY, buildPiece, funnelHalfWidthAt, pieceHitSize, spiralDepth, spiralLocal
} from './pieces';
import { clamp, lerp, TAU } from './util';

const CELL = 64;
const TRIGGER_CELL = 128;
const MARBLE_CELL = 72;
const MAX_SPEED = 3400;
const GRAVITY = 1800;
const SLOP = 0.5;
const BUBBLE_RISE = -190;
const BUBBLE_LIFE = 8;
const TRIGGER_PAD = 40;
const NO_TRIGGERS: readonly number[] = [];

interface SpiralInfo {
  pieceId: number;
  x: number;
  y: number;
  rot: number;
}

interface Channel {
  trigger: Trigger;
  cos: number;
  sin: number;
  turn: number;
  queue: Marble[];
  readyAt: number;
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
  private fans = new Map<number, Trigger>();
  private channels = new Map<number, Channel>();
  private busyMeters = new Set<Channel>();
  private clock = 0;
  private hasFunnels = false;
  private hasFields = false;
  private hasInteractions = false;
  private marbleGrid = new Map<number, number[]>();
  private marbleCells: number[] = [];
  private marblePool: number[][] = [];
  private disabled = new Map<number, number>();
  private visited = new Uint32Array(0);
  private stamp = 0;

  rebuild(pieces: Piece[]) {
    const previousChannels = this.channels;
    this.channels = new Map();
    this.busyMeters.clear();
    const disabled = new Map<string, number>();
    for (const t of this.triggers) {
      const key = `${t.kind}:${t.pieceId}`;
      disabled.set(key, Math.max(disabled.get(key) ?? 0, t.disabledUntil));
    }
    this.colliders = [];
    this.dynamicColliders = [];
    this.triggers = [];
    this.spirals = [];
    this.fans.clear();
    this.hasFunnels = false;
    this.hasFields = false;
    this.hasInteractions = false;
    for (const p of pieces) {
      const built = buildPiece(p);
      const target = p.defId === 'balance' ? this.dynamicColliders : this.colliders;
      for (const c of built.colliders) target.push(c);
      for (const t of built.triggers) {
        const prev = disabled.get(`${t.kind}:${t.pieceId}`) ?? 0;
        if (prev > t.disabledUntil) t.disabledUntil = prev;
        this.triggers.push(t);
        if (t.kind === 'fan') this.fans.set(t.pieceId, t);
        else if (t.kind === 'meter' || t.kind === 'splitter') {
          const previous = previousChannels.get(t.pieceId);
          const channel = previous?.trigger.kind === t.kind ? previous : { trigger: t, cos: 1, sin: 0, turn: -1, queue: [], readyAt: 0 };
          channel.trigger = t;
          channel.cos = Math.cos(t.rot);
          channel.sin = Math.sin(t.rot);
          this.channels.set(t.pieceId, channel);
          if (channel.queue.length || channel.readyAt > this.clock) this.busyMeters.add(channel);
        }
        else if (t.kind === 'funnel') this.hasFunnels = true;
        else if (t.kind === 'boost' || t.kind === 'magnet') this.hasFields = true;
        else this.hasInteractions = true;
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
    this.visited.fill(0);
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
    for (const trigger of this.triggers) trigger.disabledUntil = 0;
  }

  clearMeters() {
    for (const meter of this.busyMeters) {
      meter.queue.length = 0;
      meter.readyAt = this.clock;
    }
    this.busyMeters.clear();
  }

  /** Triggers cuya caja puede contener a la canica (consulta de una celda). */
  private nearbyTriggers(x: number, y: number): readonly number[] {
    return this.triggerGrid.get(cellKey(Math.floor(x / TRIGGER_CELL), Math.floor(y / TRIGGER_CELL))) ?? NO_TRIGGERS;
  }

  funnelAt(x: number, y: number, radius: number): number {
    if (!this.hasFunnels) return 0;
    const indices = this.nearbyTriggers(x, y);
    for (let i = indices.length - 1; i >= 0; i--) {
      const t = this.triggers[indices[i]];
      if (t.kind !== 'funnel') continue;
      const dx = x - t.x;
      const dy = y - t.y;
      const c = Math.cos(t.rot);
      const s = Math.sin(t.rot);
      const lx = dx * c + dy * s;
      const ly = dy * c - dx * s;
      if (ly < FUNNEL_LEFT[0].y - radius * 0.2 || ly > 94 + radius || Math.abs(lx) > t.w / 2) continue;
      if (Math.abs(lx) <= funnelHalfWidthAt(t.w, ly) - 6) return t.pieceId;
    }
    return 0;
  }

  update(marbles: Marble[], dt: number, now: number) {
    this.clock += dt;
    for (const meter of this.busyMeters) {
      let slot = 0;
      for (const m of meter.queue) {
        if (!m.alive || m.channelRide?.pieceId !== meter.trigger.pieceId || m.channelRide.releasing) continue;
        m.channelRide.slot = slot;
        meter.queue[slot++] = m;
      }
      meter.queue.length = slot;
      if (!slot && this.clock >= meter.readyAt) this.busyMeters.delete(meter);
    }
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
    if (m.fanRide) {
      this.stepFan(m, m.fanRide, dt, now);
      return;
    }
    if (m.channelRide) {
      this.stepChannel(m, m.channelRide, dt);
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
      if (this.hasFields) this.applyFields(m, h, now);
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        m.vx *= k;
        m.vy *= k;
      }
      m.x += m.vx * h;
      m.y += m.vy * h;
      if ((this.fans.size || this.channels.size) && this.passMachine(m, h, now)) return;
      this.resolveStatic(m, h, now);
    }

    if (m.contact) {
      m.airTime = 0;
      const damp = Math.exp(-m.roll * dt * 0.55);
      m.vx *= damp;
      m.vy *= damp;
    } else {
      m.airTime += dt;
    }

    if (this.hasInteractions) this.checkTriggers(m, now);

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

  private passMachine(m: Marble, dt: number, now: number): boolean {
    for (const index of this.nearbyTriggers(m.x, m.y)) {
      const t = this.triggers[index];
      if ((t.kind === 'splitter' || t.kind === 'meter') && this.enterChannel(m, this.channels.get(t.pieceId)!)) return true;
      if (t.kind !== 'fan' || (t.pieceId === m.lastFanPiece && now < m.fanReadyAt)) continue;
      const c = -t.dy;
      const s = t.dx;
      const dx = m.x - t.x;
      const dy = m.y - t.y;
      const x = dx * c + dy * s;
      const y = dy * c - dx * s;
      if (Math.abs(x) > FAN_HALF + m.r * 0.35 || y < FAN_OUTLET + 9 || y > FAN_INTAKE_BOTTOM) continue;
      if (y < FAN_INTAKE_TOP) {
        // La corriente por encima de la toma desvía sin suspender una caída vertical.
        m.vx += t.dx * t.power * dt * 0.35;
        m.vy += t.dy * t.power * dt * 0.35;
        continue;
      }
      const side = Math.abs(x) > 8 ? Math.sign(-x) : Math.sign(m.vx * c + m.vy * s) || (m.id % 2 ? 1 : -1);
      m.fanRide = { pieceId: t.pieceId, t: 0, x, y, exitX: side * 16 };
      m.vx = 0;
      m.vy = 0;
      m.contact = 0;
      m.airTime = 0;
      m.sleepTimer = 0;
      m.trail.length = 0;
      this.events.push({ type: 'fan', x: m.x, y: m.y, pieceId: t.pieceId, note: -1, impact: 0, marbleId: m.id, speed: 0 });
      return true;
    }
    return false;
  }

  private enterChannel(m: Marble, channel: Channel): boolean {
    const { trigger: t, cos, sin } = channel;
    const dx = m.x - t.x;
    const dy = m.y - t.y;
    const x = dx * cos + dy * sin;
    const y = dy * cos - dx * sin;
    const metered = t.kind === 'meter';
    const reversed = !metered && cos < -0.001;
    const side = metered ? 0 : reversed ? (x < 0 ? -1 : 1) : channel.turn;
    const direction = reversed ? -1 : 1;
    const inletX = reversed ? side * SPLITTER_EXIT_X : 0;
    const inletY = reversed ? CHANNEL_EXIT : CHANNEL_ENTRY;
    const depth = (y - inletY) * direction;
    const approach = (m.vy * cos - m.vx * sin) * direction;
    if (Math.abs(x - inletX) > 37 || depth < -12 || depth > 30 || approach < -30) return false;
    m.channelRide = { pieceId: t.pieceId, t: 0, x, y, side, reversed, slot: channel.queue.length, releasing: false };
    if (metered) {
      channel.queue.push(m);
      this.busyMeters.add(channel);
    } else if (!reversed) {
      channel.turn *= -1;
    }
    m.vx = m.vy = m.contact = m.airTime = m.sleepTimer = 0;
    m.trail.length = 0;
    return true;
  }

  private stepChannel(m: Marble, ride: NonNullable<Marble['channelRide']>, dt: number) {
    const channel = this.channels.get(ride.pieceId);
    if (!channel) {
      m.channelRide = undefined;
      return;
    }
    const { trigger: t, cos, sin } = channel;
    let x: number;
    let y: number;
    let exited = false;
    if (t.kind === 'splitter') {
      ride.t = Math.min(1, ride.t + dt / 0.39);
      const progress = ride.reversed ? 1 - ride.t : ride.t;
      const bend = clamp((progress - 0.29) / 0.71, 0, 1);
      const branchX = ride.side * SPLITTER_EXIT_X;
      const inletX = ride.reversed ? branchX : 0;
      x = lerp(ride.x - inletX, 0, Math.min(1, ride.t / 0.29)) + branchX * bend ** 1.4;
      y = lerp(ride.y, ride.reversed ? CHANNEL_ENTRY : CHANNEL_EXIT, ride.t);
      exited = ride.t === 1;
    } else if (ride.releasing) {
      ride.t = Math.min(1, ride.t + dt / 0.22);
      x = 0;
      y = lerp(1, CHANNEL_EXIT, ride.t);
      exited = ride.t === 1;
    } else {
      ride.t = Math.min(1, ride.t + dt / 0.24);
      x = lerp(ride.x, 0, ride.t);
      y = lerp(ride.y, 1 - Math.min(ride.slot, 4) * 17, ride.t);
      if (ride.t === 1 && ride.slot === 0 && this.clock >= channel.readyAt) {
        ride.t = 0;
        ride.releasing = true;
        channel.readyAt = this.clock + t.power;
        this.events.push({ type: 'channel', x: m.x, y: m.y, pieceId: t.pieceId, note: -1, impact: 0, marbleId: m.id, speed: 0 });
      }
    }
    m.px = m.x;
    m.py = m.y;
    m.x = t.x + x * cos - y * sin;
    m.y = t.y + x * sin + y * cos;
    if (exited) {
      m.channelRide = undefined;
      const sideSpeed = ride.reversed ? 0 : ride.side * 210;
      const alongSpeed = ride.reversed ? -295 : 295;
      m.vx = sideSpeed * cos - alongSpeed * sin;
      m.vy = sideSpeed * sin + alongSpeed * cos;
      if (t.kind === 'splitter') this.events.push({ type: 'channel', x: m.x, y: m.y, pieceId: t.pieceId, note: -1, impact: 0, marbleId: m.id, speed: 0 });
    }
  }

  private stepFan(m: Marble, ride: NonNullable<Marble['fanRide']>, dt: number, now: number) {
    const fan = this.fans.get(ride.pieceId);
    if (!fan) {
      m.fanRide = undefined;
      return;
    }
    ride.t = Math.min(1, ride.t + dt / 0.63);
    const entry = Math.min(1, ride.t / 0.28);
    const rise = clamp((ride.t - 0.16) / 0.84, 0, 1);
    const x = lerp(ride.x, 0, entry * (2 - entry)) + rise ** 3 * ride.exitX;
    const y = lerp(Math.min(ride.y, 100), FAN_OUTLET, rise * (0.18 + rise * 0.82)) + (1 - entry) * Math.max(0, ride.y - 100);
    const c = -fan.dy;
    const s = fan.dx;
    m.px = m.x;
    m.py = m.y;
    m.x = fan.x + x * c - y * s;
    m.y = fan.y + x * s + y * c;
    if (ride.t === 1) {
      m.fanRide = undefined;
      m.lastFanPiece = fan.pieceId;
      m.fanReadyAt = now + 900;
      const sideways = Math.sign(ride.exitX) * 145;
      m.vx = sideways * c + fan.dx * 690;
      m.vy = sideways * s + fan.dy * 690;
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
    if (this.fans.size) this.applyFields(m, dt, now);
    if (m.bubbleT > BUBBLE_LIFE || (m.bubbleT > 0.3 && this.bubbleTouchesSolid(m, now))) this.popBubble(m, now);
  }

  private bubbleTouchesSolid(m: Marble, now: number): boolean {
    const bubbleR = m.r * 1.55;
    const x0 = Math.floor((m.x - bubbleR) / CELL);
    const x1 = Math.floor((m.x + bubbleR) / CELL);
    const y0 = Math.floor((m.y - bubbleR) / CELL);
    const y1 = Math.floor((m.y + bubbleR) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const indices = this.grid.get(cellKey(x, y));
        if (!indices) continue;
        for (const i of indices) {
          if (this.overlapsBubble(m, this.colliders[i], bubbleR, now)) return true;
        }
      }
    }
    for (const c of this.dynamicColliders) {
      if (this.overlapsBubble(m, c, bubbleR, now)) return true;
    }
    return false;
  }

  private overlapsBubble(m: Marble, c: Collider, r: number, now: number): boolean {
    if ((this.disabled.get(c.pieceId) ?? 0) > now) return false;
    const p = closestOnSegment(m.x, m.y, c.ax, c.ay, c.bx, c.by);
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    return dx * dx + dy * dy <= (c.r + r) ** 2;
  }

  private popBubble(m: Marble, now: number) {
    if (!m.bubbled) return;
    m.bubbled = false;
    m.bubbleT = 0;
    m.bubbleReadyAt = now + 1200;
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
    const triggers = this.nearbyTriggers(m.x, m.y);
    for (let ti = 0; ti < triggers.length; ti++) {
      const t = this.triggers[triggers[ti]];
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
    const triggers = this.nearbyTriggers(m.x, m.y);
    for (let ti = 0; ti < triggers.length; ti++) {
      const t = this.triggers[triggers[ti]];
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
    const d2 = nx * nx + ny * ny;
    const min = m.r + c.r;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2);

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
        pitch: c.pitch,
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
    if (impact > 150 && !c.bumper && !c.chime && !c.cannon) {
      this.events.push({
        type: 'contact', x: m.x, y: m.y, pieceId: c.pieceId, note: -1, impact,
        marbleId: m.id, speed: 0, material: c.mat
      });
    }
  }

  private collideMarblePair(a: Marble, b: Marble, now: number): boolean {
    if (!a.alive || !b.alive) return false;
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
      if (!m.alive || m.bubbled || m.fanRide || m.ridePiece || m.channelRide) continue;
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
        if (!a.alive || a.bubbled || a.fanRide || a.ridePiece || a.channelRide) continue;
        for (let j = i + 1; j < n; j++) {
          const b = marbles[j];
          if (!b.alive || b.bubbled || b.fanRide || b.ridePiece || b.channelRide) continue;
          if (!this.collideMarblePair(a, b, now)) break;
        }
      }
      return;
    }
    this.rebuildMarbleGrid(marbles);
    for (let i = 0; i < n; i++) {
      const a = marbles[i];
      if (!a.alive || a.bubbled || a.fanRide || a.ridePiece || a.channelRide) continue;
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
            if (!b.alive) continue;
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
    lastFanPiece: 0,
    fanReadyAt: 0,
    bubbled: false,
    bubbleT: 0,
    bubbleReadyAt: 0
  };
}

export { TAU } from './util';
