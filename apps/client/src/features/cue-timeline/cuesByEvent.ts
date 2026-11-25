import type { CustomFieldKey, EntryId, Rundown, TimelineCue } from 'ontime-types';
import { getTimelineEventSpans, isOneShotCue, resolveTimelineCues } from 'ontime-utils';

export type EventCue = {
  cue: TimelineCue;
  /** whether the cue starts in this event, or carries on from an earlier one */
  isStart: boolean;
  /** how long after the GO of the event the cue starts */
  offset: number;
};

export type CuesByEvent = Record<EntryId, EventCue[]>;

const cache = new WeakMap<object, CuesByEvent>();

/**
 * Lists, for each event, the cues which play during it, in the order they start
 * A cue belongs to the event it starts in, and to the events it carries on through
 */
export function getCuesByEvent(rundown: Pick<Rundown, 'flatOrder' | 'entries' | 'cues'>): CuesByEvent {
  const cached = cache.get(rundown);
  if (cached) return cached;

  const result: CuesByEvent = {};
  const cues = rundown.cues ?? {};
  const spans = getTimelineEventSpans(rundown);
  const resolved = resolveTimelineCues(cues, spans);

  for (const span of spans) {
    const list: EventCue[] = [];
    for (const cueId in cues) {
      const times = resolved[cueId];
      if (!times) continue;
      const cue = cues[cueId];
      const isStart = times.start >= span.start && (times.start < span.end || span.end === span.start);
      const carriesOn = !isOneShotCue(cue) && times.start < span.start && times.end > span.start;
      if (!isStart && !carriesOn) continue;
      list.push({ cue, isStart, offset: times.start - span.start });
    }
    list.sort((a, b) => a.offset - b.offset);
    if (list.length > 0) result[span.id] = list;
  }

  cache.set(rundown, result);
  return result;
}

/**
 * The cues of an event which sit on a custom field
 */
export function getEventCuesOnTrack(byEvent: CuesByEvent, eventId: EntryId, track: CustomFieldKey): EventCue[] {
  return (byEvent[eventId] ?? []).filter((item) => item.cue.track === track);
}
