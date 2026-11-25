import type {
  CustomFieldKey,
  CustomFields,
  EntryId,
  OntimeEvent,
  Rundown,
  RundownCues,
  TimelineCue,
  TimelineCueId,
} from 'ontime-types';
import {
  MILLIS_PER_MINUTE,
  type ResolvedTimelineCues,
  type TimelineCueLayout,
  type TimelineEventSpan,
  anchorEndAt,
  anchorStartAt,
  dayInMs,
  generateId,
  getDependentCues,
  getEventAtTime,
  getPinnedCueTimes,
  getTimelineEventSpans,
  layoutTimelineCues,
  resolveTimelineCues,
} from 'ontime-utils';

export type TimelineOrientation = 'horizontal' | 'vertical';

export type TimelineTrack = {
  key: CustomFieldKey;
  label: string;
  colour: string;
  rowCount: number;
  /** the first row of the lane, counted from the top of the cue lanes */
  firstRow: number;
};

export type TimelineModel = {
  spans: TimelineEventSpan[];
  resolved: ResolvedTimelineCues;
  layout: TimelineCueLayout;
  tracks: TimelineTrack[];
  totalRows: number;
  rangeStart: number;
  rangeEnd: number;
};

/** the timeline shows a little room before the first and after the last item */
const rangePadding = 5 * MILLIS_PER_MINUTE;

/**
 * Gathers everything a timeline needs to draw a rundown and its cues
 */
export function makeTimelineModel(
  rundown: Pick<Rundown, 'flatOrder' | 'entries' | 'cues'>,
  customFields: CustomFields,
): TimelineModel {
  const spans = getTimelineEventSpans(rundown);
  const cues = rundown.cues ?? {};
  return makeTimelineModelFromSpans(spans, cues, customFields);
}

export function makeTimelineModelFromSpans(
  spans: TimelineEventSpan[],
  cues: Readonly<RundownCues>,
  customFields: CustomFields,
): TimelineModel {
  const resolved = resolveTimelineCues(cues, spans);
  // lanes are the fields set as cues, and text fields which hold cues from before fields had a type for them
  const tracksWithCues = new Set(Object.values(cues).map((cue) => cue.track));
  const trackKeys = Object.keys(customFields).filter(
    (key) => customFields[key].type === 'cue' || (customFields[key].type === 'text' && tracksWithCues.has(key)),
  );
  const layout = layoutTimelineCues(cues, resolved, trackKeys);

  let firstRow = 0;
  const tracks: TimelineTrack[] = trackKeys.map((key) => {
    const track = {
      key,
      label: customFields[key].label,
      colour: customFields[key].colour,
      rowCount: layout.rowCount[key] ?? 1,
      firstRow,
    };
    firstRow += track.rowCount;
    return track;
  });

  let min = Infinity;
  let max = -Infinity;
  for (const span of spans) {
    min = Math.min(min, span.start);
    max = Math.max(max, span.end);
  }
  for (const cueId in resolved) {
    min = Math.min(min, resolved[cueId].start);
    max = Math.max(max, resolved[cueId].end);
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }

  const rangeStart = Math.max(0, Math.floor((min - rangePadding) / rangePadding) * rangePadding);
  const rangeEnd = Math.ceil((max + rangePadding) / rangePadding) * rangePadding;

  return { spans, resolved, layout, tracks, totalRows: firstRow, rangeStart, rangeEnd };
}

/**
 * Rounds a time to a grid, used to snap drags
 */
export function snapToGrid(time: number, grid: number): number {
  if (grid <= 0) return time;
  return Math.round(time / grid) * grid;
}

/**
 * Picks a grid for snapping and for the ruler marks so that marks are not too close
 * @param pxPerMs the zoom level
 */
export function getRulerStep(pxPerMs: number, minSpacingPx = 60): number {
  const steps = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((seconds) => seconds * 1000);
  return steps.find((step) => step * pxPerMs >= minSpacingPx) ?? steps[steps.length - 1];
}

export type CueDragKind = 'move' | 'start' | 'end';

type DragContext = {
  spans: TimelineEventSpan[];
  resolved: ResolvedTimelineCues;
  /** how close to an event GO a time snaps to it */
  snap: number;
};

/**
 * Applies a drag to a cue, keeping the kind of its triggers
 * - move shifts the whole cue, a cue with a duration keeps it
 * - start moves the start and keeps the end in place
 * - end moves the end
 */
export function dragCue(cue: TimelineCue, kind: CueDragKind, delta: number, context: DragContext): TimelineCue {
  const times = context.resolved[cue.id];
  if (!times) return cue;
  const options = { spans: context.spans, resolved: context.resolved, snap: context.snap };

  // a cue which starts an event is held against its GO: a drag changes its wait and its length
  const target = cue.nextEvent?.eventId ? context.spans.find((span) => span.id === cue.nextEvent?.eventId) : undefined;
  if (cue.nextEvent && target && getPinnedCueTimes(cue, times.end - times.start, context.spans)) {
    let start = times.start;
    let end = times.end;
    if (kind === 'move') {
      start += delta;
      end += delta;
    } else if (kind === 'start') {
      start = Math.min(start + delta, end);
    } else {
      end = Math.max(end + delta, start);
    }
    const go = cue.nextEvent.trigger === 'auto-follow' ? end : start;
    const snapped = Math.abs(target.start - go) <= context.snap ? target.start : go;
    const offset = Math.max(0, Math.round(target.start - snapped));
    return {
      ...cue,
      end: { trigger: 'duration', duration: Math.max(0, Math.round(end - start)) },
      nextEvent: { ...cue.nextEvent, offset },
    };
  }

  if (kind === 'move') {
    const start = anchorStartAt(cue.start, times.start + delta, options);
    const end =
      cue.end.trigger === 'duration' ? cue.end : anchorEndAt(cue.end, times.end + delta, times.start + delta, options);
    return { ...cue, start, end };
  }

  if (kind === 'start') {
    const newStart = Math.min(times.start + delta, times.end);
    const start = anchorStartAt(cue.start, newStart, options);
    const end =
      cue.end.trigger === 'duration'
        ? { trigger: 'duration' as const, duration: Math.max(0, Math.round(times.end - newStart)) }
        : cue.end;
    return { ...cue, start, end };
  }

  const end = anchorEndAt(cue.end, times.end + delta, times.start, options);
  return { ...cue, end };
}

export type EventDragKind = 'move' | 'start' | 'end';

/**
 * Turns a drag of an event into a patch of its times
 * Moving an event unlinks it from the previous one, since it now has its own start
 */
export function dragEvent(
  event: Pick<OntimeEvent, 'id' | 'timeStart' | 'timeEnd' | 'duration'>,
  kind: EventDragKind,
  delta: number,
): Partial<OntimeEvent> & { id: EntryId } {
  const wrap = (time: number) => ((Math.round(time) % dayInMs) + dayInMs) % dayInMs;

  if (kind === 'move') {
    return {
      id: event.id,
      timeStart: wrap(event.timeStart + delta),
      timeEnd: wrap(event.timeEnd + delta),
      duration: event.duration,
      linkStart: false,
    };
  }

  if (kind === 'start') {
    const safeDelta = Math.min(delta, event.duration);
    return {
      id: event.id,
      timeStart: wrap(event.timeStart + safeDelta),
      timeEnd: event.timeEnd,
      duration: Math.round(event.duration - safeDelta),
      linkStart: false,
    };
  }

  const safeDelta = Math.max(delta, -event.duration);
  return {
    id: event.id,
    timeStart: event.timeStart,
    timeEnd: wrap(event.timeEnd + safeDelta),
    duration: Math.round(event.duration + safeDelta),
  };
}

/**
 * Makes a new cue at a point in time
 * It starts with the event at that time and ends with the GO of the next event
 */
export function makeCueAt(
  track: CustomFieldKey,
  time: number,
  spans: TimelineEventSpan[],
  snap: number,
): TimelineCue | null {
  const span = getEventAtTime(spans, time);
  if (!span) return null;

  const draftCue: TimelineCue = {
    id: 'draft',
    track,
    label: '',
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: span.id },
    end: { trigger: 'duration', duration: 0 },
    goMode: 'auto',
    followsDelay: true,
  };
  const start = anchorStartAt({ trigger: 'event-go', eventId: span.id }, time, { spans, resolved: {}, snap });
  const startTime = resolveTimelineCues({ draft: { ...draftCue, start } }, spans).draft?.start ?? time;
  const next = spans.find((candidate) => candidate.start > startTime);

  return {
    id: generateId(),
    track,
    label: 'New cue',
    note: '',
    colour: '',
    start,
    end: next ? { trigger: 'event-go', eventId: next.id } : { trigger: 'duration', duration: MILLIS_PER_MINUTE },
    goMode: 'auto',
    followsDelay: true,
  };
}

/**
 * Makes a new cue drawn between two points in time
 * It starts with the event at its start, and lasts as long as it was drawn
 * @returns null when the drawn length is too short to mean a cue
 */
export function makeCueBetween(
  track: CustomFieldKey,
  from: number,
  to: number,
  spans: TimelineEventSpan[],
  snap: number,
): TimelineCue | null {
  const cue = makeCueAt(track, from, spans, snap);
  if (!cue) return null;
  const startTime = resolveTimelineCues({ [cue.id]: cue }, spans)[cue.id]?.start ?? from;
  const end = snap > 0 ? Math.round(to / snap) * snap : to;
  const duration = Math.round(end - startTime);
  if (duration < Math.max(1000, snap)) return null;
  return { ...cue, end: { trigger: 'duration', duration } };
}

/**
 * Makes a cue linked to another one
 * - auto-follow starts when the reference ends
 * - auto-continue starts with the reference, and stacks below it
 */
export function makeLinkedCue(
  reference: TimelineCue,
  trigger: 'auto-follow' | 'auto-continue',
  resolved: ResolvedTimelineCues,
): TimelineCue {
  const times = resolved[reference.id];
  const duration = times ? Math.max(10_000, times.end - times.start) : 10_000;
  return {
    id: generateId(),
    track: reference.track,
    label: trigger === 'auto-follow' ? `${reference.label} follow` : `${reference.label} continue`,
    note: '',
    colour: '',
    start: { trigger, cueId: reference.id, offset: 0 },
    end: { trigger: 'duration', duration },
    goMode: 'auto',
    followsDelay: true,
  };
}

/**
 * Removes a cue, the cues which were linked to it keep their place by starting from the event at that time
 * Does not mutate the given cues
 */
export function removeCue(
  cues: Readonly<RundownCues>,
  cueId: TimelineCueId,
  spans: TimelineEventSpan[],
  resolved: ResolvedTimelineCues,
): RundownCues {
  const result: RundownCues = { ...cues };
  delete result[cueId];
  for (const dependent of getDependentCues(cues, cueId)) {
    const times = resolved[dependent.id];
    if (!times) {
      delete result[dependent.id];
      continue;
    }
    const start = anchorStartAt({ trigger: 'event-go', eventId: '' }, times.start, { spans, resolved });
    result[dependent.id] = { ...dependent, start };
  }
  return result;
}

/**
 * The colour a cue is drawn with
 */
export function getCueColour(cue: TimelineCue, trackColour: string | undefined): string {
  return cue.colour || trackColour || '#779be7';
}

/**
 * Describes a cue trigger in a few words for its tooltip and label
 */
export function describeCueStart(cue: TimelineCue, cues: Readonly<RundownCues>, eventLabels: Record<EntryId, string>) {
  switch (cue.start.trigger) {
    case 'event-go':
      return `GO ${eventLabels[cue.start.eventId] ?? ''}`;
    case 'inside-event':
      return `GO inside ${eventLabels[cue.start.eventId] ?? ''}`;
    case 'auto-follow':
      return `after ${cues[cue.start.cueId]?.label ?? ''}`;
    case 'auto-continue':
      return `with ${cues[cue.start.cueId]?.label ?? ''}`;
  }
}
