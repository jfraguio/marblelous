export type WorldKind = 'studio' | 'ocean' | 'sky' | 'space' | 'volcano' | 'garden';

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

/** Los índices se conservan para que las partidas anteriores mantengan su fondo. */
export const WORLD_THEMES: WorldTheme[] = [
  {
    id: 'studio',
    name: 'Normal',
    kind: 'studio',
    paper: '#FBF5EA',
    paper2: '#E7DBCA',
    grid: 'rgba(117,90,64,0.15)',
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
    paper: '#E4F3EB',
    paper2: '#B9D8D6',
    grid: 'rgba(52,115,117,0.16)',
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
    paper: '#E8F4F5',
    paper2: '#C3DCEB',
    grid: 'rgba(70,116,146,0.16)',
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
    paper: '#182239',
    paper2: '#101627',
    grid: 'rgba(166,186,225,0.21)',
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
    paper: '#3B2528',
    paper2: '#281818',
    grid: 'rgba(255,193,142,0.20)',
    ink: '#FFE7D2',
    inkSoft: '#E7B69B',
    accent: '#FF6B35',
    light: 'rgba(255,120,50,0.17)',
    shade: 'rgba(0,0,0,0.38)'
  },
  {
    id: 'garden',
    name: 'Jardín',
    kind: 'garden',
    paper: '#F5F0DC',
    paper2: '#DDE8D6',
    grid: 'rgba(55,105,73,0.18)',
    ink: '#253D32',
    inkSoft: '#506954',
    accent: '#6E9269',
    light: 'rgba(255,251,235,0.51)',
    shade: 'rgba(67,112,83,0.1)'
  }
];

export function worldTheme(index: number): WorldTheme {
  return WORLD_THEMES[index] ?? WORLD_THEMES[0];
}
