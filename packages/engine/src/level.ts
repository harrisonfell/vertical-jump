/**
 * Training age to level. A decision, not a literature result: every rule-book
 * cap scales with level, so the conservative mapping is chosen
 * (brief section 09 "Level and inputs"). Never shown to the athlete as such.
 */
import type { Level, TrainingAge } from './types/core.js';

/** None and Less than 1 year are beginner; 1-3 years intermediate; 4+ advanced. */
export function deriveLevel(trainingAge: TrainingAge): Level {
  switch (trainingAge) {
    case 'none':
    case 'lt1':
      return 'beginner';
    case '1to3':
      return 'intermediate';
    case '4plus':
      return 'advanced';
  }
}

/**
 * True when raw training age is "None", which adds the R100 tendon runway:
 * isometric weeks 1 and 2, slow resistance weeks 3 and 4, plyometric emphasis
 * from the second block.
 */
export function needsTendonRunway(trainingAge: TrainingAge): boolean {
  return trainingAge === 'none';
}
