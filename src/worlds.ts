export type WorldKind = 'studio' | 'ocean' | 'sky' | 'space';

export interface WorldTheme {
  id: string;
  name: string;
  kind: WorldKind;
  paper: string;
  paper2: string;
  grid: string;
  ink: string;
  inkSoft: string;
  accent: string;
  light: string;
  shade: string;
}

/** Cuatro mundos con fondos y detalles deliberadamente sutiles. */
export const WORLD_THEMES: WorldTheme[] = [
  {
    id: 'studio',
    name: 'Normal',
    kind: 'studio',
    paper: '#F2EFE7',
    paper2: '#E9E4D8',
    grid: 'rgba(220,214,200,0.62)',
    ink: '#23211C',
    inkSoft: '#5F5A50',
    accent: '#3D7EA6',
    light: 'rgba(255,252,242,0.26)',
    shade: 'rgba(35,33,28,0.05)'
  },
  {
    id: 'ocean',
    name: 'Fondo marino',
    kind: 'ocean',
    paper: '#E8F1F0',
    paper2: '#DAEAE7',
    grid: 'rgba(170,204,200,0.5)',
    ink: '#1E2E2E',
    inkSoft: '#4E6B6B',
    accent: '#2E9E97',
    light: 'rgba(220,255,250,0.26)',
    shade: 'rgba(30,80,90,0.06)'
  },
  {
    id: 'sky',
    name: 'Cielo',
    kind: 'sky',
    paper: '#EEF4F8',
    paper2: '#E2EDF4',
    grid: 'rgba(196,216,231,0.55)',
    ink: '#202A34',
    inkSoft: '#52657A',
    accent: '#5B9BD5',
    light: 'rgba(255,255,255,0.34)',
    shade: 'rgba(60,90,120,0.05)'
  },
  {
    id: 'space',
    name: 'Espacio',
    kind: 'space',
    paper: '#0D1020',
    paper2: '#141A31',
    grid: 'rgba(160,180,230,0.16)',
    ink: '#E8ECFF',
    inkSoft: '#A9B6D8',
    accent: '#7D5BA6',
    light: 'rgba(120,150,255,0.11)',
    shade: 'rgba(0,0,0,0.28)'
  }
];

export function worldTheme(index: number): WorldTheme {
  return WORLD_THEMES[index] ?? WORLD_THEMES[0];
}
