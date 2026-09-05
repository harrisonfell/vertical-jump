/**
 * The climbing grid's own axes: the inventory, the wall-work patterns, the gym
 * pick sets and the athlete every case starts from.
 *
 * Split out of `grid.climbing.ts` so both files stay under the 500-line limit.
 * Nothing here asserts; it only describes the space the grid walks.
 */
import { gridRuleset } from './grid.seed.js';
import { WEEKDAYS, baseAthlete } from './grid.support.js';
import type { Athlete, Inventory, WallWork } from '../src/types/athlete.js';
import type { Weekday } from '../src/types/calendar.js';
import type { DaysPerWeek } from '../src/types/core.js';

const climbing = gridRuleset.constants.climbing;

/** A weight room with a hangboard, a squat box and a climbing wall. */
export const CLIMBING_INVENTORY: Inventory = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: false,
  dumbbells: { maxLb: 100, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24, 30],
  hurdleHeightsIn: [],
  bands: true,
  medBall: true,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
  hangboard: true,
  boxSquatBox: true,
  climbingWall: true,
  weightRoomAccess: true,
};

/** The owner's own wall window: 18:00 to 20:00, and hard on the fingers. */
function evenings(weekdays: Weekday[]): WallWork {
  return {
    weekdays,
    typicalStart: '18:00',
    typicalEnd: '20:00',
    fingerLoad: 'hard',
    sameDayGapHours: 6,
  };
}

/** The wall-work patterns the grid covers. */
export const WALL_CASES: { name: string; wallWork?: WallWork }[] = [
  { name: 'no wall days' },
  { name: 'Mon Wed Fri evenings', wallWork: evenings([1, 3, 5]) },
  {
    name: 'every evening',
    wallWork: {
      weekdays: [0, 1, 2, 3, 4, 5, 6] as Weekday[],
      typicalStart: '18:00',
      typicalEnd: '21:00',
      fingerLoad: 'hard',
      sameDayGapHours: 6,
    },
  },
  // The owner's own three, and the two weeks where a fourth climb is added.
  { name: 'Tue Thu Sun evenings', wallWork: evenings([0, 2, 4]) },
  { name: 'Tue Thu Sun plus Fri', wallWork: evenings([0, 2, 4, 5]) },
  { name: 'Tue Thu Sun plus Sat', wallWork: evenings([0, 2, 4, 6]) },
];

/** The owner's gym window: mornings, ten hours clear of an evening on the wall. */
export const MORNING_WINDOW = { start: '08:00', end: '10:00' } as const;

/**
 * Gym picks that do and do not share a weekday with the wall, for the owner's
 * own Tue/Thu/Sun pattern. The first pick set puts the upper-power day on a
 * climbing day (the same-day exception); the second has no climbing day among
 * its picks at all, so the placement has to find a day 48 h clear instead.
 */
export const PICK_CASES: { name: string; days: DaysPerWeek; weekdays: Weekday[] }[] = [
  { name: 'picks with a wall weekday', days: 4, weekdays: [1, 2, 3, 5] },
  { name: 'picks with no wall weekday', days: 4, weekdays: [1, 3, 5, 6] },
  { name: '5d picks with a wall weekday', days: 5, weekdays: [1, 2, 3, 5, 6] },
];

/** The climbing athlete every case starts from. */
export function climbingAthlete(days: DaysPerWeek = 4): Athlete {
  return {
    ...baseAthlete(),
    sport: 'speed_climbing',
    secondaryGoal: 'speed',
    level: 'advanced',
    trainingAge: '4plus',
    daysPerWeek: days,
    weekdays: WEEKDAYS[days],
    inventory: CLIMBING_INVENTORY,
    fingerHistory: true,
    gripMode: 'open_hand',
    fingerPainCeiling: climbing.fingerPainCeiling,
    valgusControl: {
      required: true,
      sessionsPerWeek: climbing.rntSessionsPerWeek,
      minHoursFromWall: climbing.rntWallGapHours,
    },
    weakerSide: 'left',
    readinessConfig: { ...climbing.readiness },
  };
}
