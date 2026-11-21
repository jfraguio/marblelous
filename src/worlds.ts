export type WorldKind = 'studio' | 'ocean' | 'sky' | 'space' | 'volcano';

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
    light: 'rgba(255,252,242,0.3)',
    shade: 'rgba(35,33,28,0.06)'
  },
  {
    id: 'ocean',
    name: 'Fondo marino',
    kind: 'ocean',
    paper: '#DDEDEA',
    paper2: '#CFE4E0',
    grid: 'rgba(140,190,185,0.55)',
    ink: '#1E2E2E',
    inkSoft: '#4E6B6B',
    accent: '#2E9E97',
    light: 'rgba(225,255,250,0.36)',
    shade: 'rgba(20,70,80,0.1)'
  },
  {
    id: 'sky',
    name: 'Cielo',
    kind: 'sky',
    paper: '#E4EFF7',
    paper2: '#D6E7F2',
    grid: 'rgba(170,200,220,0.55)',
    ink: '#202A34',
    inkSoft: '#52657A',
    accent: '#5B9BD5',
    light: 'rgba(255,255,255,0.42)',
    shade: 'rgba(50,90,130,0.07)'
  },
  {
    id: 'space',
    name: 'Espacio',
    kind: 'space',
    paper: '#0B0E1C',
    paper2: '#10152A',
    grid: 'rgba(150,175,225,0.2)',
    ink: '#E8ECFF',
    inkSoft: '#A9B6D8',
    accent: '#7D5BA6',
    light: 'rgba(110,140,255,0.14)',
    shade: 'rgba(0,0,0,0.34)'
  },
  {
    id: 'volcano',
    name: 'Volcán',
    kind: 'volcano',
    paper: '#21100D',
    paper2: '#2C150F',
    grid: 'rgba(255,150,90,0.16)',
    ink: '#FFE7D2',
    inkSoft: '#E7B69B',
    accent: '#FF6B35',
    light: 'rgba(255,120,50,0.17)',
    shade: 'rgba(0,0,0,0.38)'
  }
];

export function worldTheme(index: number): WorldTheme {
  return WORLD_THEMES[index] ?? WORLD_THEMES[0];
}
