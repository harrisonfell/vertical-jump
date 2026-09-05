import { describe, expect, it } from 'vitest';
import type { SetPrescription } from '@vert/engine';
import {
  RNT_CAPTION,
  climbCaptions,
  climbPrescription,
  isRepCountedRow,
  isRntRow,
  medBallLine,
  medBallWeightLb,
  usesMedBall,
} from './climbRows';
import { exerciseIndex } from './climbing';

/**
 * How the upper power day draws, read off the seeded exercises rather than off
 * their names, so a retagged row changes its shape with its tags.
 */

const byId = exerciseIndex();

function set(reps: number, displayLoad: string): SetPrescription {
  return { setNumber: 1, reps, displayLoad, restS: 120, restRule: '3 sets', isRamp: false, isHeld: false };
}

describe('rows counted in repetitions', () => {
  it('counts a throw in reps, because the ball is the load and you are not', () => {
    expect(isRepCountedRow(byId.get('med_ball_chest_throw'))).toBe(true);
    expect(isRepCountedRow(byId.get('med_ball_rotational_throw'))).toBe(true);
    expect(isRepCountedRow(byId.get('seated_med_ball_throw'))).toBe(true);
  });

  it('counts an explosive or assisted pull in reps, because it is not a loaded pull-up', () => {
    expect(isRepCountedRow(byId.get('explosive_pull_up'))).toBe(true);
    expect(isRepCountedRow(byId.get('band_assisted_overspeed_pull'))).toBe(true);
  });

  it('leaves a real bodyweight jump and a loaded pull-up alone', () => {
    expect(isRepCountedRow(byId.get('pogo_hops'))).toBe(false);
    expect(isRepCountedRow(byId.get('weighted_pull_up'))).toBe(false);
    expect(isRepCountedRow(byId.get('box_squat'))).toBe(false);
    expect(isRepCountedRow(undefined)).toBe(false);
  });

  it('draws "3 reps", never "3 × BW"', () => {
    expect(climbPrescription(set(3, '3 × BW'), true)).toBe('3 reps');
    expect(climbPrescription(set(1, '1 × BW'), true)).toBe('1 rep');
  });

  it('leaves the engine’s own notation alone everywhere else', () => {
    expect(climbPrescription(set(5, '5 × BW + 45 lb'), false)).toBe('5 × BW + 45 lb');
    expect(climbPrescription(set(6, '6 × BW'), false)).toBe('6 × BW');
  });
});

describe('the med ball', () => {
  it('knows which rows throw one', () => {
    expect(usesMedBall(byId.get('med_ball_chest_throw'))).toBe(true);
    expect(usesMedBall(byId.get('weighted_pull_up'))).toBe(false);
  });

  it('names the weight when the inventory has one and says nothing when it does not', () => {
    expect(medBallLine(6)).toBe('6 lb ball');
    expect(medBallLine(null)).toBeNull();
    expect(medBallLine(0)).toBeNull();
    expect(medBallWeightLb({ medBall: true, medBallLb: 8 })).toBe(8);
    expect(medBallWeightLb({ medBall: true })).toBeNull();
    expect(medBallWeightLb(null)).toBeNull();
  });
});

describe('the knee-alignment rows', () => {
  it('are the ones the seed tags, not the ones whose name starts with RNT', () => {
    expect(isRntRow(byId.get('rnt_split_squat'))).toBe(true);
    expect(isRntRow(byId.get('rnt_step_down'))).toBe(true);
    expect(isRntRow(byId.get('step_up'))).toBe(false);
    expect(isRntRow(undefined)).toBe(false);
  });
});

describe('the captions', () => {
  it('read hands, then side, then what ends the set', () => {
    expect(
      climbCaptions({
        fingerNote: 'Open hand only.',
        sideNote: 'Weaker side first: left',
        isRnt: true,
      }),
    ).toEqual(['Open hand only', 'Weaker side first: left', RNT_CAPTION]);
  });

  it('are empty on a row none of the three rules touch', () => {
    expect(climbCaptions({ fingerNote: null, sideNote: null, isRnt: false })).toEqual([]);
  });

  it('says the alignment rule in words, never as a colour', () => {
    expect(RNT_CAPTION).toBe('Alignment: stop the set when the knee drifts');
  });
});
