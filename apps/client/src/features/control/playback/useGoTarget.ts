import { isOntimeEvent } from 'ontime-types';
import { getNextCueInEvent, getTimelineEventSpans, resolveTimelineCues } from 'ontime-utils';
import { useMemo } from 'react';

import { useLoadedRundown } from '../../../common/hooks-query/useLoadedRundown';
import { useCueLive } from '../../cue-timeline/useCueLive';

export type GoTarget = {
  kind: 'cue' | 'event';
  /** short text shown under the button label */
  text: string;
  /** longer description, for the tooltip */
  description: string;
};

/**
 * What the Next button fires: the next cue of the running event, or the next event
 * Follows the server, which plays the cues of the running event before moving on
 */
export function useGoTarget(selectedEventIndex: number | null): GoTarget | null {
  const { data: rundown } = useLoadedRundown();
  const live = useCueLive(rundown, true);

  const playable = useMemo(
    () =>
      rundown.flatOrder
        .map((id) => rundown.entries[id])
        .filter((entry) => entry && isOntimeEvent(entry) && !entry.skip)
        .filter(isOntimeEvent),
    [rundown.flatOrder, rundown.entries],
  );
  const spans = useMemo(() => getTimelineEventSpans(rundown), [rundown]);
  const resolved = useMemo(() => resolveTimelineCues(rundown.cues ?? {}, spans), [rundown.cues, spans]);

  if (live.eventNowId) {
    const span = spans.find((candidate) => candidate.id === live.eventNowId);
    const cueId = span ? getNextCueInEvent(rundown.cues ?? {}, resolved, span, live.entries) : null;
    const cue = cueId ? rundown.cues?.[cueId] : undefined;
    if (cue) {
      const label = cue.label || 'Untitled cue';
      const then = cue.nextEvent ? ', then the next event follows' : '';
      return { kind: 'cue', text: `Cue · ${label}`, description: `GO cue ${label}${then}` };
    }
  }

  const next = playable[selectedEventIndex === null ? 0 : selectedEventIndex + 1];
  if (!next) return null;
  const address = next.cue || String((selectedEventIndex ?? -1) + 2);
  const title = next.title ? ` ${next.title}` : '';
  return { kind: 'event', text: address, description: `Start event ${address}${title}` };
}
