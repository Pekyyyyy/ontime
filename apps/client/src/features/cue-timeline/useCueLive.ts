import { CuePlayback, Playback, Rundown, TimelineCueId } from 'ontime-types';
import { dayInMs, getCueSchedule, getNextCue, getTimelineEventSpans, resolveTimelineCues } from 'ontime-utils';
import { useMemo } from 'react';

import { useCuePlayback, useCueRuntimeData } from '../../common/hooks/useSocket';
import { useAutoTickingClock } from '../../common/stores/clockStore';

const noEntries: CuePlayback['cues'] = {};

/**
 * Where the show is against the plan, and the live state of the cues of a rundown
 * Only the loaded rundown runs, any other rundown shows its cues armed and no show
 */
export function useCueLive(rundown: Pick<Rundown, 'id' | 'flatOrder' | 'entries' | 'cues'>, isLoaded: boolean) {
  const cuePlayback = useCuePlayback();
  const { delay, currentDay, playback, eventNowId, expectedFinish } = useCueRuntimeData();
  const clock = useAutoTickingClock();

  const isActive = isLoaded && playback !== Playback.Stop;
  const effectiveDelay = isActive ? delay : 0;
  const entries = isLoaded && cuePlayback.rundownId === rundown.id ? cuePlayback.cues : noEntries;

  const resolved = useMemo(() => resolveTimelineCues(rundown.cues ?? {}, getTimelineEventSpans(rundown)), [rundown]);
  const schedule = useMemo(
    () => getCueSchedule(rundown.cues ?? {}, resolved, entries, effectiveDelay),
    [rundown.cues, resolved, entries, effectiveDelay],
  );

  /** now along the timeline, time of day plus the day of the show */
  const now = clock + currentDay * dayInMs;
  const nextCueId: TimelineCueId | null = isLoaded ? getNextCue(rundown.cues ?? {}, schedule, entries, now) : null;

  return {
    isActive,
    now,
    delay: effectiveDelay,
    /** where the show is on the plan: now, less the delay */
    planPosition: isActive && eventNowId ? now - effectiveDelay : null,
    entries,
    schedule,
    nextCueId,
    eventNowId: isLoaded ? eventNowId : null,
    /** when the running event is expected to finish, along the timeline */
    eventExpectedEnd: isActive && expectedFinish !== null ? expectedFinish + currentDay * dayInMs : null,
  };
}

export type CueLive = ReturnType<typeof useCueLive>;
