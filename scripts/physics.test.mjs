import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } });
after(() => vite.close());

const { PhysicsWorld, createMarble } = await vite.ssrLoadModule('/src/physics.ts');
const { makePiece, MARBLE_BY_ID, METER_INTERVALS, CHANNEL_ENTRY, CHANNEL_EXIT, SPLITTER_EXIT_X, xyloLayout } = await vite.ssrLoadModule('/src/pieces.ts');
const { findSnap } = await vite.ssrLoadModule('/src/snap.ts');
const { STRUCTURES } = await vite.ssrLoadModule('/src/structures.ts');
const { ALBUM_KEY, findAlbum } = await vite.ssrLoadModule('/src/album.ts');
const dt = 1 / 120;

function rotate(x, y, angle) {
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
}

function simulate(world, marble, until) {
  for (let i = 0; i < 600; i++) {
    world.clearEvents();
    world.update([marble], dt, 1000 + i * dt * 1000);
    if (until(world.events)) return true;
  }
  return false;
}

test('el ventilador recibe canicas desde ambos lados de la pista y las suelta por arriba', () => {
  const cases = [
    [0, 1, 700, 'crystal'],
    [0, -1, 700, 'crystal'],
    [0.52, 1, 3400, 'rubber'],
    [-0.52, -1, 140, 'steel'],
    [Math.PI / 2, 1, 1900, 'crystal']
  ];
  for (const [heading, side, speed, type] of cases) {
    const world = new PhysicsWorld();
    const floor = rotate(0, 116.5, heading);
    const rail = makePiece(1, 'ramp', floor.x, floor.y, heading, 560);
    const fan = makePiece(2, 'fan', 0, 0, heading);
    world.rebuild([rail, fan]);
    const start = rotate(-side * 100, 84, heading);
    const velocity = rotate(side * speed, 0, heading);
    const marble = createMarble(37, MARBLE_BY_ID.get(type), start.x, start.y, 0, 1000);
    marble.vx = velocity.x;
    marble.vy = velocity.y;
    let entries = 0;
    const exited = simulate(world, marble, (events) => {
      entries += events.filter((event) => event.type === 'fan').length;
      return marble.lastFanPiece === fan.id && !marble.fanRide;
    });
    assert.ok(exited, `no salió: ${[heading, side, speed, type]}`);
    assert.equal(entries, 1);
    assert.ok(rotate(marble.x, marble.y, -heading).y < -100);
    assert.ok(rotate(marble.vx, marble.vy, -heading).y < -400);
  }
});

test('al quitar un ventilador en marcha la canica vuelve a caer', () => {
  const world = new PhysicsWorld();
  const fan = makePiece(1, 'fan', 0, 0);
  world.rebuild([fan]);
  const marble = createMarble(1, MARBLE_BY_ID.get('crystal'), 0, 55, 0, 1000);
  assert.ok(simulate(world, marble, () => marble.fanRide?.pieceId === fan.id));
  const y = marble.y;
  world.rebuild([]);
  assert.ok(simulate(world, marble, () => !marble.fanRide && marble.y > y + 20));
});

test('el embudo deja pasar las canicas por dentro, también ensanchado o girado', () => {
  const cases = [[188, 0, 0, 'crystal'], [188, 68, 0, 'rubber'], [560, 220, 0, 'steel'], [340, -100, Math.PI / 12, 'rubber']];
  for (const [width, x, heading, type] of cases) {
    const world = new PhysicsWorld();
    const funnel = makePiece(2, 'funnel', 0, 0, heading, width);
    world.rebuild([funnel]);
    const start = rotate(x, -180, heading);
    const marble = createMarble(1, MARBLE_BY_ID.get(type), start.x, start.y, 0, 1000);
    let inside = false;
    const exited = simulate(world, marble, () => {
      inside ||= world.funnelAt(marble.x, marble.y, marble.r) === funnel.id;
      const current = rotate(marble.x, marble.y, -heading);
      return current.y > 122 && Math.abs(current.x) < 55;
    });
    assert.ok(inside && exited, `no recorrió el embudo: ${[width, x, heading, type]}`);
    assert.equal(world.funnelAt(marble.x, marble.y, marble.r), 0);
  }
});

test('el canal conecta con la rampa y mantiene el encaje mientras el puntero oscila', () => {
  const rail = makePiece(1, 'ramp', 0, 100);
  const channel = makePiece(2, 'sTrack', 290, 146);
  const snap = findSnap(channel, [rail], 1);
  assert.deepEqual([snap.x, snap.y, snap.jointX, snap.jointY], [280, 140, 160, 100]);
  channel.x = 326;
  assert.equal(findSnap(channel, [rail], 1), null);
  assert.equal(findSnap(channel, [rail], 1, snap.key)?.key, snap.key);
  channel.x = 335;
  assert.equal(findSnap(channel, [rail], 1, snap.key), null);
});

test('La Brisa lleva la canica de la fábrica al xilófono pasando por el ventilador', () => {
  const demo = STRUCTURES.find((structure) => structure.id === 'viento');
  const pieces = demo.pieces.map((p, index) => makePiece(index + 1, p.defId, p.x, p.y, p.rot, p.len));
  const world = new PhysicsWorld();
  world.rebuild(pieces);
  const [factory, funnel] = pieces;
  const marble = createMarble(1, MARBLE_BY_ID.get('crystal'), factory.x, factory.y + 72, 0, 1000);
  marble.vy = 30;
  let seenFunnel = false;
  let seenFan = false;
  const played = simulate(world, marble, (events) => {
    seenFunnel ||= world.funnelAt(marble.x, marble.y, marble.r) === funnel.id;
    seenFan ||= events.some((event) => event.type === 'fan');
    return events.some((event) => event.type === 'chime');
  });
  assert.ok(seenFunnel, 'la canica no entró al embudo');
  assert.ok(seenFan, 'la canica no llegó al ventilador');
  assert.ok(played, 'la canica no tocó el xilófono');
});

test('la bifurcación alterna salidas incluso girada y al reconstruir la rejilla', () => {
  const world = new PhysicsWorld();
  const heading = Math.PI / 6;
  const splitter = makePiece(1, 'splitter', 0, 0, heading);
  const inlet = rotate(0, CHANNEL_ENTRY - 2, heading);
  const velocity = rotate(0, 1200, heading);
  const outlets = [];
  for (let id = 1; id <= 4; id++) {
    world.rebuild([splitter]);
    const marble = createMarble(id, MARBLE_BY_ID.get('crystal'), inlet.x, inlet.y, 0, 0);
    marble.vx = velocity.x;
    marble.vy = velocity.y;
    assert.ok(simulate(world, marble, (events) => events.some((event) => event.type === 'channel')));
    const exit = rotate(marble.x, marble.y, -heading);
    assert.equal(Math.round(exit.y), CHANNEL_EXIT);
    outlets.push(Math.round(exit.x));
  }
  assert.deepEqual(outlets, [-SPLITTER_EXIT_X, SPLITTER_EXIT_X, -SPLITTER_EXIT_X, SPLITTER_EXIT_X]);
});

test('la bifurcación invertida reúne las dos patas en la salida central', () => {
  for (const heading of [Math.PI, Math.PI + Math.PI / 6]) {
    const world = new PhysicsWorld();
    const piece = makePiece(1, 'splitter', 140, 50, heading);
    world.rebuild([piece]);
    const velocity = rotate(0, -1200, heading);
    const marbles = [-1, 1].map((side, i) => {
      const inlet = rotate(side * SPLITTER_EXIT_X, CHANNEL_EXIT + 8, heading);
      const marble = createMarble(i + 1, MARBLE_BY_ID.get('crystal'), piece.x + inlet.x, piece.y + inlet.y, 0, 0);
      marble.vx = velocity.x;
      marble.vy = velocity.y;
      return marble;
    });
    const releases = [];
    for (let step = 0; step < 100 && releases.length < 2; step++) {
      world.clearEvents();
      world.update(marbles, dt, step * dt * 1000);
      releases.push(...world.events.filter((event) => event.type === 'channel'));
    }
    assert.deepEqual(releases.map((event) => event.marbleId), [1, 2]);
    for (const event of releases) {
      const exit = rotate(event.x - piece.x, event.y - piece.y, -heading);
      assert.ok(Math.abs(exit.x) < 1e-8);
      assert.equal(Math.round(exit.y), CHANNEL_ENTRY);
    }
    assert.ok(marbles.every((marble) => !marble.channelRide && rotate(marble.vx, marble.vy, -heading).y < 0));
  }
});

test('el dosificador respeta la cola y mantiene los tres intervalos en tiempo de simulación', () => {
  for (const [variant, interval] of METER_INTERVALS.entries()) {
    const world = new PhysicsWorld();
    const meter = makePiece(1, 'meter', 0, 0);
    meter.variant = variant;
    world.rebuild([meter]);
    const marbles = [1, 2, 3, 4].map((id) => createMarble(id, MARBLE_BY_ID.get('steel'), 0, CHANNEL_ENTRY, 0, 0));
    const releases = [];
    for (let step = 0; step < 600; step++) {
      world.clearEvents();
      // Un salto del reloj de pared no acelera el mecanismo.
      world.update(marbles, dt, step * 70);
      for (const event of world.events) if (event.type === 'channel') releases.push({ id: event.marbleId, time: step * dt });
      if (step === 45) world.rebuild([meter]);
    }
    assert.deepEqual(releases.map((release) => release.id), [1, 2, 3, 4]);
    for (let i = 1; i < releases.length; i++) {
      assert.ok(Math.abs(releases[i].time - releases[i - 1].time - interval) <= dt + 1e-8);
    }
    assert.ok(marbles.every((marble) => !marble.channelRide));
  }
});

test('el xilófono conserva el índice visual de la lámina cuando se afina', () => {
  const world = new PhysicsWorld();
  const xylo = makePiece(1, 'xylo5', 0, 0);
  xylo.notes = [4, 1, 2, 3, 0];
  world.rebuild([xylo]);
  const marble = createMarble(1, MARBLE_BY_ID.get('crystal'), xyloLayout(5).xs[0], -100, 0, 0);
  assert.ok(simulate(world, marble, (events) => events.some((e) => e.type === 'chime' && e.note === 0 && e.pitch === 4)));
});

test('el álbum migra partidas antiguas sin duplicarlas y reabre el último taller nombrado', () => {
  const ramp = makePiece(1, 'ramp', 0, 100);
  const fan = makePiece(2, 'fan', 10, 200);
  const empty = { pieces: [] };
  const previous = { activeWorld: 2, worlds: [empty, empty, { pieces: [ramp] }], settings: { sound: 0 } };
  const storage = new Map([
    ['marblelous.save.v1', JSON.stringify({ ...previous, worlds: [empty, empty, empty] })],
    ['marblelous.lastgame.v1', JSON.stringify(previous)],
    ['marblelous.backup.v1', JSON.stringify(previous)],
    ['marblelous.snapshots.v1', JSON.stringify([{ activeWorld: 3, worlds: [empty, empty, empty, { pieces: [fan] }] }])]
  ]);
  const local = { getItem: (key) => storage.get(key) ?? null };
  const migrated = findAlbum(local);
  assert.deepEqual(migrated.workshops.map((w) => w.pieces[0].defId), ['ramp', 'fan']);
  assert.equal(migrated.settings.sound, 0);
  assert.equal(migrated.settings.haptics, true);
  assert.equal(migrated.activeId, migrated.workshops[0].id);
  migrated.workshops[1].name = 'Ritmo';
  migrated.activeId = migrated.workshops[1].id;
  migrated.settings.haptics = false;
  storage.set(ALBUM_KEY, JSON.stringify(migrated));
  const reloaded = findAlbum(local);
  assert.equal(reloaded.workshops.find((w) => w.id === reloaded.activeId).name, 'Ritmo');
  assert.equal(reloaded.settings.haptics, false);
  assert.ok(storage.has('marblelous.lastgame.v1'));
});
