/**
 * Composiciones de piezas pensadas a mano para empezar a jugar sin tener que
 * construir desde cero. Cada estructura se guarda como una lista de piezas en
 * coordenadas de mundo; el juego la carga tal cual y recentra la cámara.
 */
export interface StructurePiece {
  defId: string;
  x: number;
  y: number;
  rot?: number;
  len?: number;
  color?: number;
  variant?: number;
  polarity?: number;
  powered?: boolean;
}

export interface StructureDef {
  id: string;
  name: string;
  blurb: string;
  pieces: StructurePiece[];
}

const DEG = Math.PI / 180;

function ramp(x: number, y: number, rot: number, len = 320, color = 0): StructurePiece {
  return { defId: 'ramp', x, y, rot, len, color };
}

function conveyor(x: number, y: number, rot: number, len = 320): StructurePiece {
  return { defId: 'conveyor', x, y, rot, len };
}

function funnel(x: number, y: number, len = 260, color = 0): StructurePiece {
  return { defId: 'funnel', x, y, len, color };
}

function xylo(x: number, y: number, rot = 0): StructurePiece {
  return { defId: 'xylo5', x, y, rot };
}

function bumper(x: number, y: number): StructurePiece {
  return { defId: 'bumper', x, y };
}

function star(x: number, y: number): StructurePiece {
  return { defId: 'star', x, y };
}

function goal(x: number, y: number): StructurePiece {
  return { defId: 'goal', x, y };
}

/**
 * Escalera de rampas que baja en zigzag. `sx,sy` es el extremo alto de la
 * primera rampa y cada tramo alterna el sentido.
 */
function zigzag(
  sx: number,
  sy: number,
  steps: number,
  len: number,
  angleDeg: number,
  first: 1 | -1,
  colorBase: number
): { pieces: StructurePiece[]; x: number; y: number } {
  const a = angleDeg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pieces: StructurePiece[] = [];
  let x = sx;
  let y = sy;
  let dir = first;
  for (let i = 0; i < steps; i++) {
    pieces.push(ramp(x + dir * (len / 2) * c, y + (len / 2) * s, dir === 1 ? a : Math.PI - a, len, (colorBase + i) % 6));
    x += dir * len * c;
    y += len * s;
    dir = dir === 1 ? -1 : 1;
  }
  return { pieces, x, y };
}

/** Cinta que asciende en zigzag, para subir canicas sin ayuda externa. */
function escalator(
  sx: number,
  sy: number,
  steps: number,
  len: number,
  angleDeg: number,
  first: 1 | -1
): { pieces: StructurePiece[]; x: number; y: number } {
  const a = angleDeg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pieces: StructurePiece[] = [];
  let x = sx;
  let y = sy;
  let dir = first;
  for (let i = 0; i < steps; i++) {
    pieces.push(
      conveyor(
        x + dir * (len / 2) * c,
        y - (len / 2) * s,
        dir === 1 ? -a : Math.PI + a,
        len
      )
    );
    x += dir * len * c;
    y -= len * s;
    dir = dir === 1 ? -1 : 1;
  }
  return { pieces, x, y };
}

function structure(id: string, name: string, blurb: string, pieces: StructurePiece[]): StructureDef {
  return { id, name, blurb, pieces };
}

// ---------------------------------------------------------------------------
// 1 · La Cascada
// ---------------------------------------------------------------------------

function cascade(): StructureDef {
  const pieces: StructurePiece[] = [];
  pieces.push({ defId: 'marbleFactory', x: -150, y: -1040, powered: true });
  pieces.push(funnel(0, -900, 440, 0));
  pieces.push({ defId: 'spiral', x: 0, y: -690 });
  pieces.push(...zigzag(40, -520, 9, 300, 12, 1, 1).pieces);
  pieces.push(ramp(333, 50, 10 * DEG, 380, 0));
  pieces.push(xylo(900, 180, 10 * DEG));
  pieces.push(goal(900, 330));
  // Red de seguridad: recoge lo que se sale por la izquierda.
  pieces.push(funnel(-220, -80, 340, 1));
  pieces.push(...zigzag(-210, 10, 2, 260, 13, 1, 2).pieces);
  pieces.push(goal(-450, 160));
  // Rebotes y estrellas alrededor de la cascada.
  pieces.push(bumper(-140, -420));
  pieces.push(bumper(490, -350));
  pieces.push(bumper(-90, -210));
  pieces.push(bumper(500, -30));
  pieces.push(bumper(-300, -520));
  pieces.push(star(170, -600));
  pieces.push(star(330, -380));
  pieces.push(star(90, -150));
  pieces.push(star(650, 300));
  pieces.push(star(-80, 110));
  pieces.push(star(-390, -30));
  return structure('cascada', 'La Cascada', 'Fábrica, espiral y un largo descenso que suena al final.', pieces);
}

// ---------------------------------------------------------------------------
// 2 · El Vórtice
// ---------------------------------------------------------------------------

function vortex(): StructureDef {
  const pieces: StructurePiece[] = [];
  // Bucle: embudo → espiral → rampa larga → cinta → burbuja → cielo abierto.
  pieces.push(funnel(0, -900, 560, 0));
  pieces.push({ defId: 'spiral', x: 0, y: -660 });
  pieces.push(ramp(353, -410, 18 * DEG, 620, 1));
  pieces.push(conveyor(300, -250, Math.PI, 760));
  pieces.push({ defId: 'bubbleLift', x: 0, y: -326.5 });
  // Desagüe para las canicas que pasan de largo.
  pieces.push(goal(-280, -140));
  // Isla musical para las canicas que se escapan.
  pieces.push(ramp(764, -175, 40 * DEG, 220, 5));
  pieces.push(xylo(1000, 10, 22 * DEG));
  pieces.push(goal(1200, 110));
  pieces.push({ defId: 'portal', x: 180, y: -320, rot: Math.PI / 2, len: 200 });
  // Obstáculos que no cortan el chorro central.
  pieces.push(bumper(620, -700));
  pieces.push(bumper(300, -640));
  pieces.push(bumper(-240, -500));
  pieces.push(bumper(-180, -230));
  pieces.push(star(210, -820));
  pieces.push(star(-150, -450));
  pieces.push(star(500, -560));
  pieces.push(star(820, -260));
  pieces.push(star(-120, -80));
  pieces.push(star(620, -180));
  pieces.push(star(360, -1010));
  return structure('vortice', 'El Vórtice', 'Un bucle de burbuja y espiral: suelta una canica y déjala girar.', pieces);
}

// ---------------------------------------------------------------------------
// 3 · La Orquesta
// ---------------------------------------------------------------------------

function orchestra(): StructureDef {
  const pieces: StructurePiece[] = [];
  // Centro: fábrica, balancín y caída con espiral.
  pieces.push({ defId: 'marbleFactory', x: 0, y: -1100, powered: true });
  pieces.push(funnel(0, -960, 340, 0));
  pieces.push({ defId: 'balance', x: 0, y: -800, color: 2 });
  pieces.push(funnel(0, -660, 300, 4));
  pieces.push({ defId: 'spiral', x: 0, y: -480 });
  pieces.push(...zigzag(40, -300, 3, 260, 12, 1, 5).pieces);
  pieces.push(xylo(500, -100, 9 * DEG));
  pieces.push(goal(800, -20));
  // Ala izquierda: dos xilófonos y campana.
  pieces.push({ defId: 'marbleFactory', x: -480, y: -1100, powered: true });
  pieces.push(funnel(-480, -980, 300, 1));
  pieces.push(xylo(-700, -760, Math.PI - 0.2));
  pieces.push(xylo(-1080, -600, Math.PI - 0.2));
  pieces.push(goal(-1420, -470));
  // Ala derecha, en espejo.
  pieces.push({ defId: 'marbleFactory', x: 480, y: -1100, powered: true });
  pieces.push(funnel(480, -980, 300, 3));
  pieces.push(xylo(700, -760, 0.2));
  pieces.push(xylo(1080, -600, 0.2));
  pieces.push(goal(1420, -470));
  // Mazas y notas suspendidas.
  pieces.push(bumper(-300, -930));
  pieces.push(bumper(300, -930));
  pieces.push(bumper(-900, -850));
  pieces.push(bumper(900, -850));
  pieces.push(star(0, -860));
  pieces.push(star(-430, -720));
  pieces.push(star(430, -720));
  pieces.push(star(-1280, -520));
  pieces.push(star(1280, -520));
  pieces.push(star(300, -260));
  pieces.push({ defId: 'hourglass', x: -520, y: -340 });
  pieces.push({ defId: 'hourglass', x: 520, y: -340 });
  return structure('orquesta', 'La Orquesta', 'Tres líneas de canicas y cinco xilófonos para componer sin parar.', pieces);
}

// ---------------------------------------------------------------------------
// 4 · La Factoría
// ---------------------------------------------------------------------------

function factory(): StructureDef {
  const pieces: StructurePiece[] = [];
  // Línea izquierda: fábrica, cinta y xilófono.
  pieces.push({ defId: 'marbleFactory', x: -650, y: -1040, powered: true });
  pieces.push(funnel(-650, -940, 340, 0));
  pieces.push(conveyor(-480, -800, 0, 500));
  pieces.push(funnel(-100, -720, 340, 1));
  pieces.push(xylo(120, -580, 9 * DEG));
  pieces.push(goal(470, -480));
  // Línea central: la máquina grande.
  pieces.push(funnel(0, -1120, 440, 4));
  pieces.push({ defId: 'spiral', x: 0, y: -900 });
  pieces.push(...zigzag(40, -720, 6, 300, 12, 1, 5).pieces);
  pieces.push(funnel(0, -220, 440, 2));
  pieces.push(conveyor(0, -60, 0, 500));
  pieces.push({ defId: 'cannon', x: 200, y: -90.5 });
  pieces.push({ defId: 'portal', x: 620, y: 40, rot: -Math.PI / 2, len: 260 });
  pieces.push(goal(760, 170));
  // Línea derecha, en espejo de la izquierda.
  pieces.push({ defId: 'marbleFactory', x: 650, y: -1140, powered: true });
  pieces.push(funnel(650, -1040, 340, 3));
  pieces.push(conveyor(480, -900, Math.PI, 500));
  pieces.push(funnel(100, -820, 340, 5));
  pieces.push(xylo(-120, -680, Math.PI - 0.16));
  pieces.push(goal(-470, -580));
  // Escalera mecánica que devuelve canicas al centro.
  pieces.push(...escalator(-420, 460, 4, 420, 17, 1).pieces);
  pieces.push(funnel(-420, 150, 460, 0));
  pieces.push(conveyor(-160, 280, 0, 520));
  pieces.push(ramp(100, 300, 10 * DEG, 220, 3));
  pieces.push(goal(460, 400));
  pieces.push({ defId: 'fan', x: 720, y: 240 });
  // Máquinas y rebotes.
  pieces.push({ defId: 'cannon', x: -300, y: -830.5 });
  pieces.push({ defId: 'cannon', x: 300, y: -930.5 });
  pieces.push(bumper(-260, -560));
  pieces.push(bumper(300, -560));
  pieces.push(bumper(-900, -700));
  pieces.push(bumper(900, -700));
  pieces.push(bumper(600, 240));
  pieces.push(bumper(-600, 260));
  pieces.push(star(0, -980));
  pieces.push(star(-430, -460));
  pieces.push(star(430, -460));
  pieces.push(star(-1120, -620));
  pieces.push(star(1120, -620));
  pieces.push(star(-320, 120));
  pieces.push(star(480, 100));
  return structure('factoria', 'La Factoría', 'Dos fábricas, cintas, cañones y una escalera mecánica para experimentar.', pieces);
}

// ---------------------------------------------------------------------------
// 5 · Las Constelaciones
// ---------------------------------------------------------------------------

function constellation(): StructureDef {
  const pieces: StructurePiece[] = [];
  // Torre central: espiral → abanico de rampas → cinta → carillón.
  pieces.push(funnel(0, -960, 380, 0));
  pieces.push({ defId: 'spiral', x: 0, y: -750 });
  pieces.push(...zigzag(40, -580, 5, 280, 12, 1, 1).pieces);
  pieces.push(conveyor(320, -180, Math.PI, 360));
  pieces.push(funnel(100, -60, 320, 2));
  pieces.push(xylo(300, 120, 0.12));
  pieces.push(goal(660, 230));
  // Torre izquierda: bucle de burbuja para lanzar canicas a mano.
  pieces.push(funnel(-620, -580, 440, 2));
  pieces.push(conveyor(-620, -420, 0, 420));
  pieces.push({ defId: 'bubbleLift', x: -620, y: -496.5 });
  // Torre derecha: fábrica, xilófono y descenso hasta la campana.
  pieces.push({ defId: 'marbleFactory', x: 760, y: -1000, powered: true });
  pieces.push(xylo(760, -740, 20 * DEG));
  pieces.push(funnel(850, -560, 340, 3));
  pieces.push(...zigzag(850, -440, 3, 240, 12, 1, 3).pieces);
  pieces.push(goal(1250, -230));
  pieces.push({ defId: 'fan', x: 620, y: -300 });
  // Isla del balancín, abajo a la izquierda.
  pieces.push({ defId: 'balance', x: -780, y: -40, color: 5 });
  pieces.push(...zigzag(-900, 90, 2, 220, 12, 1, 4).pieces);
  pieces.push(goal(-1060, 260));
  // Detalles suspendidos.
  pieces.push({ defId: 'electromagnet', x: 260, y: -520, polarity: 1 });
  pieces.push(bumper(-300, -900));
  pieces.push(bumper(400, -880));
  pieces.push(bumper(-1120, -400));
  pieces.push(bumper(1120, -520));
  pieces.push(bumper(-760, 260));
  pieces.push(bumper(300, 420));
  pieces.push(star(-620, -760));
  pieces.push(star(-340, -300));
  pieces.push(star(300, -180));
  pieces.push(star(760, -880));
  pieces.push(star(980, -380));
  pieces.push(star(420, 40));
  pieces.push(star(-300, 200));
  pieces.push(star(-1000, 180));
  pieces.push(star(1120, -120));
  return structure('constelaciones', 'Las Constelaciones', 'Islas, burbujas y viento: un cielo de piezas para explorar.', pieces);
}

export const STRUCTURES: StructureDef[] = [cascade(), vortex(), orchestra(), factory(), constellation()];
