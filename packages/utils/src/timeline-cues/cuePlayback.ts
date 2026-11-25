import type { CuePlayback, CuePlaybackEntry, EntryId, RundownCues, TimelineCue, TimelineCueId } from 'ontime-types';

import type { ResolvedTimelineCues } from './timelineCues.js';

type PlaybackEntries = CuePlayback['cues'];

/** how late an automatic cue may still fire, eg: after the server was busy or the show was started late */
export const cueFireGrace = 3000;

export type CueScheduleEntry = {
  /** when the cue is expected to, or did, start along the timeline */
  start: number;
  end: number;
};

export type CueSchedule = Record<TimelineCueId, CueScheduleEntry>;

/**
 * Cues which start from another cue run when that cue runs
 */
export function isChainedCue(cue: TimelineCue): cue is TimelineCue & {
  start: { trigger: 'auto-follow' | 'auto-continue'; cueId: TimelineCueId; offset: number };
} {
  return cue.start.trigger === 'auto-follow' || cue.start.trigger === 'auto-continue';
}

/**
 * A cue with no length has a single GO and nothing to stop
 */
export function isOneShotCue(cue: TimelineCue): boolean {
  return cue.end.trigger === 'duration' && cue.end.duration === 0;
}

function hasPlayed(entry: CuePlaybackEntry | undefined): entry is CuePlaybackEntry {
  return entry !== undefined && entry.status !== 'test';
}

/**
 * Works out when each cue is expected to run, given what has run so far and the running delay
 * - cues which ran keep the times they ran at
 * - cues chained to a cue which ran follow it
 * - other cues keep their planned time, moved by the delay when they follow it
 * @param delay the running delay of the show, positive when behind
 */
export function getCueSchedule(
  cues: Readonly<RundownCues>,
  resolved: ResolvedTimelineCues,
  playback: Readonly<PlaybackEntries>,
  delay: number,
): CueSchedule {
  const schedule: CueSchedule = {};
  const visiting = new Set<TimelineCueId>();

  function compute(cueId: TimelineCueId): CueScheduleEntry | null {
    if (schedule[cueId]) return schedule[cueId];
    const cue = cues[cueId];
    const times = resolved[cueId];
    if (!cue || !times || visiting.has(cueId)) return null;
    visiting.add(cueId);

    const length = times.end - times.start;
    let entry: CueScheduleEntry | null = null;
    const played = playback[cueId];

    if (hasPlayed(played)) {
      entry = { start: played.firedAt, end: played.endsAt };
    } else if (isChainedCue(cue)) {
      const reference = playback[cue.start.cueId];
      const referenceTimes = hasPlayed(reference)
        ? { start: reference.firedAt, end: reference.endsAt }
        : compute(cue.start.cueId);
      if (referenceTimes) {
        const base = cue.start.trigger === 'auto-follow' ? referenceTimes.end : referenceTimes.start;
        const start = base + cue.start.offset;
        entry = { start, end: start + length };
      }
    } else {
      const start = times.start + (cue.followsDelay ? delay : 0);
      entry = { start, end: start + length };
    }

    visiting.delete(cueId);
    if (entry) schedule[cueId] = entry;
    return entry;
  }

  for (const cueId in cues) {
    compute(cueId);
  }
  return schedule;
}

/**
 * Lists the cues which should fire by themselves now
 * - automatic cues whose time came, unless it passed long ago
 * - cues chained to a cue which ran, once their wait is over
 * Manual cues wait for a GO
 */
export function getDueCues(
  cues: Readonly<RundownCues>,
  schedule: CueSchedule,
  playback: Readonly<PlaybackEntries>,
  now: number,
  grace = cueFireGrace,
): TimelineCueId[] {
  const due: { id: TimelineCueId; start: number }[] = [];
  for (const cueId in cues) {
    const cue = cues[cueId];
    const times = schedule[cueId];
    if (!times || playback[cueId]) continue;

    if (isChainedCue(cue)) {
      if (hasPlayed(playback[cue.start.cueId]) && now >= times.start) due.push({ id: cueId, start: times.start });
      continue;
    }

    if (cue.goMode !== 'auto') continue;
    if (now >= times.start && now - times.start <= grace) due.push({ id: cueId, start: times.start });
  }
  return due.sort((a, b) => a.start - b.start).map((item) => item.id);
}

/**
 * Automatic cues which fire with the GO of an event, whatever the clock says
 */
export function getEventGoCues(cues: Readonly<RundownCues>, eventId: EntryId): TimelineCueId[] {
  return Object.values(cues)
    .filter((cue) => cue.goMode === 'auto' && cue.start.trigger === 'event-go' && cue.start.eventId === eventId)
    .map((cue) => cue.id);
}

/**
 * The next cue waiting to run, the first armed cue which is not long overdue
 * @param window how far back an armed cue still counts as next, eg: a manual cue the operator has not called yet
 */
export function getNextCue(
  cues: Readonly<RundownCues>,
  schedule: CueSchedule,
  playback: Readonly<PlaybackEntries>,
  now: number,
  window = 10 * 60_000,
): TimelineCueId | null {
  let next: TimelineCueId | null = null;
  for (const cueId in cues) {
    const times = schedule[cueId];
    if (!times || playback[cueId] || times.start < now - window) continue;
    if (next === null || times.start < schedule[next].start) next = cueId;
  }
  return next;
}

/**
 * Makes the playback entry of a cue which gets its GO now
 */
export function fireCueEntry(
  cueId: TimelineCueId,
  schedule: CueSchedule,
  now: number,
  status: 'running' | 'test',
): CuePlaybackEntry {
  const times = schedule[cueId];
  const length = times ? Math.max(0, times.end - times.start) : 0;
  return { status: length === 0 && status === 'running' ? 'done' : status, firedAt: now, endsAt: now + length };
}

/**
 * Moves cues which reached their end to done, and forgets tests which ended
 * @returns the same object when nothing changed
 */
export function settleCuePlayback(playback: Readonly<PlaybackEntries>, now: number): PlaybackEntries {
  let changed = false;
  const result: PlaybackEntries = {};
  for (const cueId in playback) {
    const entry = playback[cueId];
    if (entry.status === 'done' || entry.endsAt > now) {
      result[cueId] = entry;
      continue;
    }
    changed = true;
    if (entry.status === 'running') result[cueId] = { ...entry, status: 'done' };
  }
  return changed ? result : (playback as PlaybackEntries);
}
