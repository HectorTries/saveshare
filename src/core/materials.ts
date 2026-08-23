/* ---------- materials ----------
   value = how much each block adds to your melt pot
   durability: ice chips in 1 hit, wood 2-3, stone 4-5 (find the efficient route!)
   density drives Matter mass (per-unit-area), friction/restitution tune the feel. */
export type MatKey = 'ice' | 'wood' | 'stone' | 'gold' | 'tnt';

export interface MatDef {
  hp: number;
  density: number;
  friction: number;
  restitution: number;
  color: string;
  dark: string;
  edge: string;
  value: number;
}

export const MATS: Record<MatKey, MatDef> = {
  ice:   { hp: 1,   density: 0.00045, friction: 0.55, restitution: 0.02, color: '#A8D5E5', dark: '#7FB8D0', edge: '#D7EBF4', value: 3 },
  wood:  { hp: 3,   density: 0.0009,  friction: 0.60, restitution: 0.05, color: '#C17A4A', dark: '#9C5F35', edge: '#E0A878', value: 5 },
  stone: { hp: 8,   density: 0.0016,  friction: 0.70, restitution: 0.01, color: '#8A93A6', dark: '#676F83', edge: '#B3BBC9', value: 4 },
  gold:  { hp: 2,   density: 0.0012,  friction: 0.60, restitution: 0.05, color: '#F2B84B', dark: '#D99A2B', edge: '#FFE29A', value: 10 },
  tnt:   { hp: 1,   density: 0.001,   friction: 0.50, restitution: 0.05, color: '#FF6B4A', dark: '#C94A2E', edge: '#FFB09A', value: 10 },
};

// how much ball energy each material eats on impact (ice lets you through, stone stops you)
export const BLEED: Record<MatKey, number> = {
  ice: 0.93, wood: 0.78, stone: 0.55, gold: 0.72, tnt: 0.85,
};

export const GROUND_Y = 556;
export const W = 1280;
export const H = 640;
