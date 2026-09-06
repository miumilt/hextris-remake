export const APP_TITLE = 'HEXTRIS';
export const BLOCK_COLORS = ['coral', 'amber', 'teal', 'sky'] as const;
export const FIXED_STEP_MS = 1000 / 60;
export const SIDE_COUNT = 6;
export const HEX_APOTHEM = 72;
export const BLOCK_DEPTH = 24;
export const START_DISTANCE = 520;
export const MAX_STACK_DEPTH = 12;
export const COMBO_WINDOW_MS = 1200;
export const CYCLE_DURATION_MS = 55_000;
export const FLOW_END_MS = 30_000;
export const PRESSURE_END_MS = 45_000;
export const ANOMALY_WARNING_MS = 1_000;
export const MAX_FALL_SPEED = 780;
export const MIN_WAVE_INTERVAL_MS = 320;

export const VISUAL_COLORS = {
  background: '#171918',
  backgroundLift: '#202321',
  ink: '#EEE9DF',
  muted: '#8D918C',
  coral: '#D96C5F',
  amber: '#D7A84A',
  teal: '#5C9D91',
  sky: '#6E9FBC',
  hexTop: '#343936',
  hexBottom: '#252825',
} as const;
