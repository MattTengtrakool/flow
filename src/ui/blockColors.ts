import type {WorklogCalendarBlock} from '../worklog/types';

export type BlockPalette = {
  bg: string;
  border: string;
  dot: string;
  text: string;
  // Used for compact hour-grid chips where we want more saturation on the
  // left edge and a soft fill on the body.
  accent: string;
  softBg: string;
};

const DEFAULT_PALETTE: BlockPalette = {
  bg: '#f1ece1',
  border: '#d9d2c4',
  dot: '#8a8478',
  text: '#1a1a1a',
  accent: '#a59e8c',
  softBg: '#f5f1e6',
};

const PALETTES: Record<string, BlockPalette> = {
  coding: {
    bg: '#ede3fd',
    border: '#cfb8f0',
    dot: '#6f3bf5',
    text: '#3d1f7a',
    accent: '#6f3bf5',
    softBg: '#f4ecff',
  },
  research: {
    bg: '#dfecfa',
    border: '#b9d4f0',
    dot: '#2f7cd6',
    text: '#1a4d82',
    accent: '#2f7cd6',
    softBg: '#ebf3fb',
  },
  review: {
    bg: '#fbeedd',
    border: '#eed6b0',
    dot: '#c2630a',
    text: '#7c3f00',
    accent: '#d97706',
    softBg: '#fdf5e6',
  },
  writing: {
    bg: '#dcf2ee',
    border: '#b0dacf',
    dot: '#0f9488',
    text: '#065f56',
    accent: '#14b8a6',
    softBg: '#e9f7f3',
  },
  communication: {
    bg: '#fbdce8',
    border: '#f0bdce',
    dot: '#c92471',
    text: '#831843',
    accent: '#db2777',
    softBg: '#fdecf1',
  },
  planning: {
    bg: '#e1def9',
    border: '#c4c0f2',
    dot: '#4f46e5',
    text: '#312e81',
    accent: '#4f46e5',
    softBg: '#efedfd',
  },
  browsing: {
    bg: '#e7ebee',
    border: '#ccd3d9',
    dot: '#64748b',
    text: '#334155',
    accent: '#64748b',
    softBg: '#f1f3f5',
  },
  file_management: {
    bg: '#def1e4',
    border: '#b2d8bd',
    dot: '#157c3c',
    text: '#0a4d23',
    accent: '#15803d',
    softBg: '#ecf6ef',
  },
  meeting: {
    bg: '#fcdede',
    border: '#f3b9b9',
    dot: '#c21f1f',
    text: '#7f1d1d',
    accent: '#dc2626',
    softBg: '#fdecec',
  },
  other: DEFAULT_PALETTE,
};

export function paletteForCategory(category: string | undefined): BlockPalette {
  if (category == null) return DEFAULT_PALETTE;
  return PALETTES[category] ?? DEFAULT_PALETTE;
}

export function paletteForBlock(block: WorklogCalendarBlock): BlockPalette {
  return paletteForCategory(block.category);
}

export function labelForCategory(category: string | undefined): string {
  if (category == null || category === 'other') return 'General';
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase());
}

export const CATEGORY_LEGEND: Array<{
  key: string;
  label: string;
  palette: BlockPalette;
}> = [
  'coding',
  'writing',
  'review',
  'research',
  'communication',
  'planning',
  'meeting',
  'browsing',
  'file_management',
  'other',
].map(key => ({
  key,
  label: labelForCategory(key),
  palette: paletteForCategory(key),
}));
