import type {
  CustomFieldKey,
  CustomFields,
  EntryId,
  Rundown,
  RundownCues,
  TimelineCue,
  TimelineCueEnd,
  TimelineCueId,
  TimelineCueStart,
} from 'ontime-types';
import { isOntimeEvent } from 'ontime-types';

import { dayInMs } from '../date-utils/conversionUtils.js';

/**
 * The planned position of an event on the timeline, in absolute milliseconds
 * Day offsets are folded in, so events after midnight sort after the ones before
 */
export type TimelineEventSpan = {
  id: EntryId;
  start: number;
  end: number;
};

export type ResolvedTimelineCue = {
  start: number;
  end: number;
};

export type ResolvedTimelineCues = Record<TimelineCueId, ResolvedTimelineCue>;

/**
 * Collects the planned span of every event in the rundown, in rundown order
 * Delays are not included, the timeline shows the plan
 */
export function getTimelineEventSpans(rundown: Pick<Rundown, 'flatOrder' | 'entries'>): TimelineEventSpan[] {
  const spans: TimelineEventSpan[] = [];
  for (let i = 0; i < rundown.flatOrder.length; i++) {
    const entry = rundown.entries[rundown.flatOrder[i]];
    if (!entry || !isOntimeEvent(entry)) continue;
    const start = entry.timeStart + (entry.dayOffset ?? 0) * dayInMs;
    spans.push({ id: entry.id, start, end: start + entry.duration });
  }
  return spans;
}

function toSpanMap(spans: TimelineEventSpan[]): Map<EntryId, TimelineEventSpan> {
  return new Map(spans.map((span) => [span.id, span]));
}

/**
 * Resolves the absolute start and end of every cue
 * Cues whose references are missing or circular are left out
 */
export function resolveTimelineCues(cues: Readonly<RundownCues>, spans: TimelineEventSpan[]): ResolvedTimelineCues {
  const spanMap = toSpanMap(spans);
  const resolved: ResolvedTimelineCues = {};
  const failed = new Set<TimelineCueId>();
  const visiting = new Set<TimelineCueId>();

  function resolve(cueId: TimelineCueId): ResolvedTimelineCue | null {
    if (resolved[cueId]) return resolved[cueId];
    if (failed.has(cueId)) return null;
    const cue = cues[cueId];
    if (!cue || visiting.has(cueId)) {
      failed.add(cueId);
      return null;
    }

    visiting.add(cueId);
    const start = resolveStart(cue.start);
    const end = start === null ? null : resolveEnd(cue.end, start);
    visiting.delete(cueId);

    if (start === null || end === null) {
      failed.add(cueId);
      return null;
    }

    resolved[cueId] = { start, end: Math.max(start, end) };
    return resolved[cueId];
  }

  function resolveStart(start: TimelineCueStart): number | null {
    switch (start.trigger) {
      case 'event-go':
        return spanMap.get(start.eventId)?.start ?? null;
      case 'inside-event': {
        const span = spanMap.get(start.eventId);
        return span ? span.start + start.offset : null;
      }
      case 'auto-follow': {
        const reference = resolve(start.cueId);
        return reference ? reference.end + start.offset : null;
      }
      case 'auto-continue': {
        const reference = resolve(start.cueId);
        return reference ? reference.start + start.offset : null;
      }
    }
  }

  function resolveEnd(end: TimelineCueEnd, start: number): number | null {
    switch (end.trigger) {
      case 'duration':
        return start + end.duration;
      case 'event-go':
        return spanMap.get(end.eventId)?.start ?? null;
      case 'inside-event': {
        const span = spanMap.get(end.eventId);
        return span ? span.start + end.offset : null;
      }
    }
  }

  for (const cueId in cues) {
    resolve(cueId);
  }

  return resolved;
}

/**
 * Finds the event which a point in time belongs to
 * A time between events belongs to the event before it, a time before the first event to the first event
 */
export function getEventAtTime(spans: TimelineEventSpan[], time: number): TimelineEventSpan | null {
  if (spans.length === 0) return null;
  let candidate: TimelineEventSpan = spans[0];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.start <= time && time < span.end) return span;
    if (span.start <= time && span.start >= candidate.start) candidate = span;
  }
  return candidate;
}

type AnchorOptions = {
  spans: TimelineEventSpan[];
  resolved: ResolvedTimelineCues;
  /** how close to an event GO a time snaps to it, in milliseconds */
  snap?: number;
};

/**
 * Anchors an event based trigger at a point in time, snapping to the event GO when close enough
 */
function anchorToEvent(
  time: number,
  { spans, snap = 0 }: AnchorOptions,
): { trigger: 'event-go'; eventId: EntryId } | { trigger: 'inside-event'; eventId: EntryId; offset: number } | null {
  // a time close to the GO of the next event snaps to it
  let nearest: TimelineEventSpan | null = null;
  for (const span of spans) {
    const distance = Math.abs(span.start - time);
    if (distance <= snap && (!nearest || distance < Math.abs(nearest.start - time))) nearest = span;
  }
  if (nearest) {
    return { trigger: 'event-go', eventId: nearest.id };
  }

  const span = getEventAtTime(spans, time);
  if (!span) return null;
  const offset = Math.round(time - span.start);
  if (offset <= 0) {
    return { trigger: 'event-go', eventId: span.id };
  }
  return { trigger: 'inside-event', eventId: span.id, offset };
}

/**
 * Keeps the kind of trigger of a start and moves it to a new point in time
 */
export function anchorStartAt(start: TimelineCueStart, time: number, options: AnchorOptions): TimelineCueStart {
  switch (start.trigger) {
    case 'event-go':
    case 'inside-event':
      return anchorToEvent(time, options) ?? start;
    case 'auto-follow': {
      const reference = options.resolved[start.cueId];
      if (!reference) return start;
      return { ...start, offset: Math.max(0, Math.round(time - reference.end)) };
    }
    case 'auto-continue': {
      const reference = options.resolved[start.cueId];
      if (!reference) return start;
      return { ...start, offset: Math.max(0, Math.round(time - reference.start)) };
    }
  }
}

/**
 * Keeps the kind of trigger of an end and moves it to a new point in time
 */
export function anchorEndAt(end: TimelineCueEnd, time: number, start: number, options: AnchorOptions): TimelineCueEnd {
  const safeTime = Math.max(start, time);
  if (end.trigger === 'duration') {
    return { trigger: 'duration', duration: Math.round(safeTime - start) };
  }
  return anchorToEvent(safeTime, options) ?? end;
}

/**
 * Makes a start of a given trigger, placed as close as possible to a point in time
 */
export function makeStart(
  trigger: TimelineCueStart['trigger'],
  time: number,
  reference: { eventId?: EntryId; cueId?: TimelineCueId },
  options: AnchorOptions,
): TimelineCueStart | null {
  if (trigger === 'auto-follow' || trigger === 'auto-continue') {
    if (!reference.cueId) return null;
    return anchorStartAt({ trigger, cueId: reference.cueId, offset: 0 }, time, options);
  }

  const eventId = reference.eventId ?? getEventAtTime(options.spans, time)?.id;
  if (!eventId) return null;
  const span = options.spans.find((candidate) => candidate.id === eventId);
  if (!span) return null;
  if (trigger === 'event-go') return { trigger, eventId };
  return { trigger, eventId, offset: Math.max(0, Math.round(time - span.start)) };
}

/**
 * Makes an end of a given trigger, placed as close as possible to a point in time
 */
export function makeEnd(
  trigger: TimelineCueEnd['trigger'],
  time: number,
  start: number,
  reference: { eventId?: EntryId },
  options: AnchorOptions,
): TimelineCueEnd | null {
  if (trigger === 'duration') {
    return { trigger, duration: Math.max(0, Math.round(time - start)) };
  }
  const eventId = reference.eventId ?? getEventAtTime(options.spans, time)?.id;
  if (!eventId) return null;
  const span = options.spans.find((candidate) => candidate.id === eventId);
  if (!span) return null;
  if (trigger === 'event-go') return { trigger, eventId };
  return { trigger, eventId, offset: Math.max(0, Math.round(time - span.start)) };
}

/**
 * Lists the cues whose start depends on the given cue
 */
export function getDependentCues(cues: Readonly<RundownCues>, cueId: TimelineCueId): TimelineCue[] {
  return Object.values(cues).filter(
    (cue) =>
      (cue.start.trigger === 'auto-follow' || cue.start.trigger === 'auto-continue') && cue.start.cueId === cueId,
  );
}

/**
 * Whether starting a cue from a reference would make a loop
 */
export function wouldCreateCycle(cues: Readonly<RundownCues>, cueId: TimelineCueId, referenceId: TimelineCueId) {
  let current: TimelineCueId | undefined = referenceId;
  const seen = new Set<TimelineCueId>();
  while (current && !seen.has(current)) {
    if (current === cueId) return true;
    seen.add(current);
    const cue: TimelineCue | undefined = cues[current];
    if (!cue) return false;
    current =
      cue.start.trigger === 'auto-follow' || cue.start.trigger === 'auto-continue' ? cue.start.cueId : undefined;
  }
  return false;
}

function referencesEvent(anchor: TimelineCueStart | TimelineCueEnd, eventIds: Set<EntryId>): boolean {
  return 'eventId' in anchor && !eventIds.has(anchor.eventId);
}

/**
 * Keeps the cues valid after the rundown or the custom fields change
 * - a cue on a custom field which no longer exists is removed
 * - a cue which points at an event or cue which no longer exists is re-anchored at the time it had,
 *   when that time is known, otherwise it is removed
 * - circular references are broken by re-anchoring at the previous time, or removed
 * Does not mutate the given cues
 */
export function sanitiseTimelineCues(
  cues: Readonly<RundownCues>,
  spans: TimelineEventSpan[],
  customFields: Readonly<CustomFields>,
  previous: ResolvedTimelineCues = {},
): RundownCues {
  const eventIds = new Set(spans.map((span) => span.id));
  const result: RundownCues = {};
  const options: AnchorOptions = { spans, resolved: previous };

  for (const cueId in cues) {
    const cue = cues[cueId];
    if (!Object.hasOwn(customFields, cue.track)) continue;

    let start: TimelineCueStart | null = cue.start;
    let end: TimelineCueEnd | null = cue.end;
    const previousTimes = previous[cueId];

    const isStartMissing =
      referencesEvent(start, eventIds) ||
      ((start.trigger === 'auto-follow' || start.trigger === 'auto-continue') && !cues[start.cueId]);
    if (isStartMissing) {
      start = previousTimes ? anchorToEvent(previousTimes.start, options) : null;
    }

    if (start && referencesEvent(end, eventIds)) {
      end = previousTimes ? (anchorToEvent(previousTimes.end, options) ?? null) : null;
    }

    if (!start || !end) continue;
    result[cueId] = { ...cue, start, end };
  }

  // break loops, which a client could only send by mistake
  for (const cueId in result) {
    const cue = result[cueId];
    if (cue.start.trigger !== 'auto-follow' && cue.start.trigger !== 'auto-continue') continue;
    if (!wouldCreateCycle(result, cueId, cue.start.cueId)) continue;
    const previousTimes = previous[cueId];
    const start = previousTimes ? anchorToEvent(previousTimes.start, options) : null;
    if (start) {
      result[cueId] = { ...cue, start };
    } else {
      delete result[cueId];
    }
  }

  // a one-shot cue has no length, a cue starting with it starts after it: it is an auto-follow
  for (const cueId in result) {
    const cue = result[cueId];
    if (cue.start.trigger !== 'auto-continue') continue;
    const reference = result[cue.start.cueId];
    if (reference && reference.end.trigger === 'duration' && reference.end.duration === 0) {
      result[cueId] = { ...cue, start: { ...cue.start, trigger: 'auto-follow' } };
    }
  }

  return result;
}

/**
 * Moves the cues of a custom field to its new key
 * Does not mutate the given cues
 */
export function renameTimelineCueTrack(
  cues: Readonly<RundownCues>,
  oldKey: CustomFieldKey,
  newKey: CustomFieldKey,
): RundownCues {
  const result: RundownCues = {};
  for (const cueId in cues) {
    const cue = cues[cueId];
    result[cueId] = cue.track === oldKey ? { ...cue, track: newKey } : cue;
  }
  return result;
}

export type TimelineCueLayout = {
  /** the row of each cue inside its lane */
  rows: Record<TimelineCueId, number>;
  /** how many rows each lane needs, at least one */
  rowCount: Record<CustomFieldKey, number>;
};

/**
 * Places the cues of each lane in rows so that they do not overlap
 * Cues which auto-continue from another cue start with it, so they land in the rows below it
 */
export function layoutTimelineCues(
  cues: Readonly<RundownCues>,
  resolved: ResolvedTimelineCues,
  tracks: CustomFieldKey[],
): TimelineCueLayout {
  const rows: Record<TimelineCueId, number> = {};
  const rowCount: Record<CustomFieldKey, number> = {};

  for (const track of tracks) {
    const trackCues = Object.values(cues)
      .filter((cue) => cue.track === track && resolved[cue.id])
      .sort((a, b) => {
        const delta = resolved[a.id].start - resolved[b.id].start;
        if (delta !== 0) return delta;
        // a cue which continues another sits below it
        if (a.start.trigger === 'auto-continue' && a.start.cueId === b.id) return 1;
        if (b.start.trigger === 'auto-continue' && b.start.cueId === a.id) return -1;
        return a.id.localeCompare(b.id);
      });

    const rowEnds: number[] = [];
    for (const cue of trackCues) {
      const { start, end } = resolved[cue.id];
      let row = rowEnds.findIndex((rowEnd) => rowEnd <= start);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(end);
      } else {
        rowEnds[row] = end;
      }
      // a zero length cue still takes its place
      if (end === start) rowEnds[row] = start + 1;
      rows[cue.id] = row;
    }
    rowCount[track] = Math.max(1, rowEnds.length);
  }

  return { rows, rowCount };
}
