import type { TimelineCueId } from '../core/TimelineCue.type.js';

/**
 * - running: the cue had its GO and has not reached its end
 * - done: the cue played, it needs a rearm to play again
 * - test: the cue is being tested, it does not count as played
 * - stopped: a panic stopped the cue, it needs a rearm and the cues chained to it do not run
 */
export type CuePlaybackStatus = 'running' | 'done' | 'test' | 'stopped';

export type CuePlaybackEntry = {
  status: CuePlaybackStatus;
  /** when the cue had its GO, in milliseconds along the timeline (time of day plus the day of the show) */
  firedAt: number;
  /** when the cue ends, along the same axis */
  endsAt: number;
};

/**
 * The live state of the cues of the loaded rundown
 * A cue without an entry is armed
 */
export type CuePlayback = {
  rundownId: string | null;
  cues: Record<TimelineCueId, CuePlaybackEntry>;
};
