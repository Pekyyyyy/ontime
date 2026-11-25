import { millisToString } from 'ontime-utils';

import { useLoadedRundown } from '../../../common/hooks-query/useLoadedRundown';
import { timerPlaceholder } from '../../../common/utils/styleUtils';
import { useCueLive } from '../../cue-timeline/useCueLive';
import { TimeColumn } from './TimeLayout';

import style from './CueOverview.module.scss';

/**
 * Counts down to the next timeline cue, and to whatever comes next: a cue or the end of the running event
 * Only shows for rundowns with cues
 */
export function CueOverview() {
  const { data: rundown } = useLoadedRundown();
  const live = useCueLive(rundown, true);

  if (Object.keys(rundown.cues ?? {}).length === 0) return null;

  const nextCue = live.nextCueId ? rundown.cues?.[live.nextCueId] : undefined;
  const nextStart = live.nextCueId ? live.schedule[live.nextCueId]?.start : undefined;
  const untilCue = nextStart === undefined ? null : nextStart - live.now;

  const isWaitingForGo = untilCue !== null && untilCue <= 0;
  const cueLabel = nextCue ? `Cue: ${nextCue.label || 'Untitled'}` : 'Next cue';
  const cueValue = untilCue === null ? timerPlaceholder : isWaitingForGo ? 'GO' : millisToString(untilCue);

  // the cue timer counts to the next thing to happen, the next cue or the end of the event
  const untilEventEnd = live.eventExpectedEnd === null ? null : live.eventExpectedEnd - live.now;
  const targets = [untilCue, untilEventEnd].filter((value): value is number => value !== null && value > 0);
  const cueTimer = targets.length > 0 ? Math.min(...targets) : null;

  return (
    <>
      <TimeColumn
        label={cueLabel}
        value={cueValue}
        state={untilCue === null ? 'muted' : isWaitingForGo ? 'waiting' : 'active'}
        testId='next-cue-countdown'
        className={style.nextCue}
      />
      <TimeColumn
        label='Cue timer'
        value={cueTimer === null ? timerPlaceholder : millisToString(cueTimer)}
        state={cueTimer === null ? 'muted' : 'active'}
        testId='cue-timer'
      />
    </>
  );
}
