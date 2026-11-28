import type { AlbumSave, Camera, Piece, Settings, Workshop } from './types';
import { COLORS, defaultLen, getPieceDef, MARBLE_BY_ID, METER_INTERVALS, PIECE_BY_ID, xyloNotes } from './pieces';
import { clamp } from './util';
import { WORLD_THEMES } from './worlds';

export const ALBUM_KEY = 'marblelous.album.v2';
const LEGACY_KEYS = ['marblelous.save.v1', 'marblelous.lastgame.v1', 'marblelous.backup.v1', 'marblelous.snapshots.v1'];
export const NORMAL_THEME = WORLD_THEMES.findIndex((theme) => theme.id === 'studio');
export const DEFAULT_SETTINGS: Settings = { quality: 'auto', haptics: true, sound: 2 };

interface LegacySave {
  settings?: Partial<Settings>;
  selectedMarble?: string;
  updatedAt?: number;
  activeWorld?: number;
  worlds?: { pieces?: Piece[]; camera?: Camera }[];
}

function readJSON<T>(storage: Storage, key: string): T | null {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

export function newCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function themeIndex(value: unknown): number {
  return clamp(Math.floor(finite(value, NORMAL_THEME)), 0, WORLD_THEMES.length - 1);
}

function normalizeSettings(raw?: Partial<Settings>): Settings {
  return {
    quality: raw?.quality === 'low' || raw?.quality === 'high' ? raw.quality : 'auto',
    haptics: raw?.haptics ?? DEFAULT_SETTINGS.haptics,
    sound: raw?.sound === 0 || raw?.sound === 1 ? raw.sound : 2
  };
}

/** Solo se guardan los datos de construcción, sin animaciones ni estado de la física. */
export function savedPiece(piece: Piece): Piece {
  return {
    id: piece.id, defId: piece.defId, x: piece.x, y: piece.y, rot: piece.rot, len: piece.len,
    color: piece.color, variant: piece.variant, polarity: piece.polarity, powered: piece.powered,
    notes: piece.notes?.slice()
  };
}

function readWorkshop(raw: Partial<Workshop>, id: string, name: string): Workshop {
  const pieces: Piece[] = [];
  const used = new Set<number>();
  let nextId = 1;
  for (const entry of Array.isArray(raw.pieces) ? raw.pieces.slice(0, 2000) : []) {
    if (!entry || !PIECE_BY_ID.has(entry.defId)) continue;
    const def = getPieceDef(entry.defId);
    let id = finite(entry.id, 0);
    if (!Number.isSafeInteger(id) || id < 1 || used.has(id) || id > 1e9) {
      while (used.has(nextId)) nextId++;
      id = nextId++;
    }
    used.add(id);
    pieces.push({
      id, defId: def.id, x: finite(entry.x, 0), y: finite(entry.y, 0), rot: finite(entry.rot, 0),
      len: clamp(finite(entry.len, 0) || defaultLen(def.id), 0, 2400),
      color: clamp(Math.floor(finite(entry.color, def.defaultColor)), 0, COLORS.length - 1),
      variant: def.id === 'meter' ? clamp(Math.floor(finite(entry.variant, 1)), 0, METER_INTERVALS.length - 1) : finite(entry.variant, 0),
      polarity: def.id === 'electromagnet' && entry.polarity === -1 ? -1 : undefined,
      powered: def.id === 'marbleFactory' ? entry.powered !== false : undefined,
      notes: def.id === 'xylo5' && Array.isArray(entry.notes) ? xyloNotes(entry.notes) : undefined
    });
  }
  return {
    id, name, pieces, updatedAt: finite(raw.updatedAt, Date.now()), theme: themeIndex(raw.theme),
    camera: { x: finite(raw.camera?.x, 0), y: finite(raw.camera?.y, 0), zoom: clamp(finite(raw.camera?.zoom, 1), 0.3, 2.5) },
    intro: raw.intro === 'drop' || raw.intro === 'edit' || raw.intro === 'again' ? raw.intro : undefined
  };
}

export function findAlbum(storage: Storage): AlbumSave | null {
  const raw = readJSON<AlbumSave>(storage, ALBUM_KEY);
  if (raw?.v === 2 && Array.isArray(raw.workshops)) {
    const ids = new Set<string>();
    const workshops: Workshop[] = [];
    for (const [i, entry] of raw.workshops.entries()) {
      if (!entry || typeof entry !== 'object') continue;
      let id = typeof entry.id === 'string' && entry.id ? entry.id : `recuperado-${i}`;
      while (ids.has(id)) id += '-copia';
      ids.add(id);
      const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 48) : '';
      workshops.push(readWorkshop(entry, id, name || 'Taller sin título'));
    }
    if (workshops.length) return {
      v: 2, activeId: workshops.find((w) => w.id === raw.activeId)?.id ?? workshops[0].id, workshops,
      settings: normalizeSettings(raw.settings), selectedMarble: chooseMarble(raw.selectedMarble)
    };
  }
  return migrateLegacy(storage);
}

function chooseMarble(raw?: string): string {
  return raw && MARBLE_BY_ID.has(raw) ? raw : 'crystal';
}

function migrateLegacy(storage: Storage): AlbumSave | null {
  const saves = LEGACY_KEYS.slice(0, 3).map((key) => readJSON<LegacySave>(storage, key));
  const snapshots = readJSON<LegacySave[]>(storage, LEGACY_KEYS[3]);
  const workshops: Workshop[] = [];
  const seen = new Set<string>();
  const append = (save: LegacySave | null, name: string) => {
    if (!Array.isArray(save?.worlds)) return;
    const theme = themeIndex(save.activeWorld);
    const world = save.worlds[theme]?.pieces?.length ? save.worlds[theme] : save.worlds.find((w) => w?.pieces?.length);
    if (!world) return;
    const workshop = readWorkshop({ ...world, theme, updatedAt: save.updatedAt }, `previo-${workshops.length + 1}`, name);
    const key = JSON.stringify([workshop.theme, workshop.pieces]);
    if (!workshop.pieces.length || seen.has(key)) return;
    seen.add(key);
    workshops.push(workshop);
  };
  for (const save of saves) append(save, workshops.length ? 'Copia anterior' : 'Mi taller anterior');
  if (Array.isArray(snapshots)) snapshots.forEach((save, index) => append(save, `Partida anterior ${index + 1}`));
  const preferences = saves.find((save) => save && typeof save === 'object');
  if (!workshops.length && !preferences) return null;
  return {
    v: 2, activeId: workshops[0]?.id ?? '', workshops, settings: normalizeSettings(preferences?.settings),
    selectedMarble: chooseMarble(preferences?.selectedMarble)
  };
}

export function clearWorkshopStorage(storage: Storage) {
  for (const key of [ALBUM_KEY, ...LEGACY_KEYS]) storage.removeItem(key);
}
