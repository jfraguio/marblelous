import type { Piece } from './types';
import { pieceBaseMount, pieceLength, piecePorts } from './pieces';
import { clamp } from './util';

export interface Snap {
  key: string;
  x: number;
  y: number;
  jointX: number;
  jointY: number;
}

export function findSnap(piece: Piece, pieces: Piece[], zoom: number, previous?: string): Snap | null {
  const radius = clamp(39 / zoom, 19, 62);
  const mount = pieceBaseMount(piece.defId);
  const booster = piece.defId === 'booster';
  const c = Math.cos(piece.rot);
  const s = Math.sin(piece.rot);
  if (mount || booster) {
    const ox = mount ? -s * mount.bottom : 0;
    const oy = mount ? c * mount.bottom : 0;
    const px = piece.x + ox;
    const py = piece.y + oy;
    let best: Snap | null = null;
    let bestDistance = Infinity;
    for (const track of pieces) {
      if (track.id === piece.id) continue;
      if (track.defId !== 'ramp' && track.defId !== 'conveyor' && track.defId !== 'bubble') continue;
      const half = pieceLength(track) / 2;
      if (Math.abs(px - track.x) > half + radius + 38 || Math.abs(py - track.y) > half + radius + 38) continue;
      const tc = Math.cos(track.rot);
      const ts = Math.sin(track.rot);
      const along = clamp((px - track.x) * tc + (py - track.y) * ts, -half, half);
      const tx = track.x + tc * along;
      const ty = track.y + ts * along;
      const key = `${track.id}:track`;
      const distance = Math.hypot(px - tx, py - ty) - (booster ? 32 : 0);
      if (distance > radius + (key === previous ? 14 : 0)) continue;
      const trackRadius = track.defId === 'bubble' ? 5 : 8;
      // El propulsor queda hacia arriba; las bases conservan el lado local de la pista.
      const side = booster && tc < 0 ? -1 : 1;
      const nx = ts * side;
      const ny = -tc * side;
      const jointX = tx + nx * trackRadius;
      const jointY = ty + ny * trackRadius;
      const gap = booster ? 41 : 0.5;
      const result = { key, x: jointX + nx * gap - ox, y: jointY + ny * gap - oy, jointX, jointY };
      if (key === previous) return result;
      if (distance >= bestDistance) continue;
      best = result;
      bestDistance = distance;
    }
    if (best) return best;
  }

  const ports = piecePorts(piece).map((a) => ({
    x: piece.x + a.x * c - a.y * s,
    y: piece.y + a.x * s + a.y * c,
    dx: a.dx * c - a.dy * s,
    dy: a.dx * s + a.dy * c
  }));
  if (!ports.length) return null;
  let best: Snap | null = null;
  let bestDistance = Infinity;
  const reach = Math.max(...ports.map((a) => Math.hypot(a.x - piece.x, a.y - piece.y))) + radius + 14;
  for (const target of pieces) {
    if (target.id === piece.id) continue;
    const targetReach = Math.max(168, pieceLength(target) / 2);
    if (Math.abs(target.x - piece.x) > reach + targetReach || Math.abs(target.y - piece.y) > reach + targetReach) continue;
    const targetPorts = piecePorts(target);
    if (!targetPorts.length) continue;
    const tc = Math.cos(target.rot);
    const ts = Math.sin(target.rot);
    for (let bi = 0; bi < targetPorts.length; bi++) {
      const b = targetPorts[bi];
      const bx = target.x + b.x * tc - b.y * ts;
      const by = target.y + b.x * ts + b.y * tc;
      const bdx = b.dx * tc - b.dy * ts;
      const bdy = b.dx * ts + b.dy * tc;
      for (let ai = 0; ai < ports.length; ai++) {
        const a = ports[ai];
        const alignment = -(a.dx * bdx + a.dy * bdy);
        if (alignment < 0.7) continue;
        const dx = bx - a.x;
        const dy = by - a.y;
        const key = `${target.id}:${ai}:${bi}`;
        const distance = Math.hypot(dx, dy);
        if (distance > radius + (key === previous ? 14 : 0)) continue;
        const result = { key, x: piece.x + dx, y: piece.y + dy, jointX: bx, jointY: by };
        if (key === previous) return result;
        const rank = distance + (1 - alignment) * 15;
        if (rank >= bestDistance) continue;
        best = result;
        bestDistance = rank;
      }
    }
  }
  return best;
}
