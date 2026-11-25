import type { RundownCues, TimelineCue } from 'ontime-types';

import {
  fireCueEntry,
  getCueSchedule,
  getDueCues,
  getEventGoCues,
  getNextCue,
  getNextCueInEvent,
  isOneShotCue,
  panicCuePlayback,
  settleCuePlayback,
} from './cuePlayback.js';
import { resolveTimelineCues, type TimelineEventSpan } from './timelineCues.js';

const spans: TimelineEventSpan[] = [
  { id: 'e1', start: 1000, end: 2000 },
  { id: 'e2', start: 2000, end: 3000 },
];

function makeCue(patch: Partial<TimelineCue> & Pick<TimelineCue, 'id'>): TimelineCue {
  return {
    track: 'camera',
    label: patch.id,
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: 'e1' },
    end: { trigger: 'duration', duration: 100 },
    goMode: 'auto',
    followsDelay: true,
    ...patch,
  };
}

function toCues(...cues: TimelineCue[]): RundownCues {
  return Object.fromEntries(cues.map((cue) => [cue.id, cue]));
}

describe('getCueSchedule()', () => {
  const cues = toCues(
    makeCue({ id: 'a' }),
    makeCue({ id: 'fixed', followsDelay: false, start: { trigger: 'inside-event', eventId: 'e1', offset: 500 } }),
    makeCue({ id: 'follow', start: { trigger: 'auto-follow', cueId: 'a', offset: 10 } }),
    makeCue({ id: 'with', start: { trigger: 'auto-continue', cueId: 'a', offset: 5 } }),
  );
  const resolved = resolveTimelineCues(cues, spans);

  it('moves cues which follow the delay', () => {
    expect(getCueSchedule(cues, resolved, {}, 200)).toEqual({
      a: { start: 1200, end: 1300 },
      fixed: { start: 1500, end: 1600 },
      follow: { start: 1310, end: 1410 },
      with: { start: 1205, end: 1305 },
    });
  });

  it('chains cues to the time their reference really ran', () => {
    const schedule = getCueSchedule(cues, resolved, { a: { status: 'running', firedAt: 5000, endsAt: 5100 } }, 0);
    expect(schedule.a).toEqual({ start: 5000, end: 5100 });
    expect(schedule.follow).toEqual({ start: 5110, end: 5210 });
    expect(schedule.with).toEqual({ start: 5005, end: 5105 });
  });
});

describe('getDueCues()', () => {
  const cues = toCues(
    makeCue({ id: 'auto' }),
    makeCue({ id: 'manual', goMode: 'manual' }),
    makeCue({ id: 'follow', start: { trigger: 'auto-follow', cueId: 'manual', offset: 0 } }),
  );
  const resolved = resolveTimelineCues(cues, spans);

  it('fires automatic cues on time, but not long after it', () => {
    const schedule = getCueSchedule(cues, resolved, {}, 0);
    expect(getDueCues(cues, schedule, {}, 999)).toEqual([]);
    expect(getDueCues(cues, schedule, {}, 1000)).toEqual(['auto']);
    expect(getDueCues(cues, schedule, {}, 60_000)).toEqual([]);
  });

  it('fires chained cues once their reference had a GO, but not after a test', () => {
    const played = { manual: { status: 'done' as const, firedAt: 1000, endsAt: 1100 } };
    const schedule = getCueSchedule(cues, resolved, played, 0);
    expect(getDueCues(cues, schedule, played, 1100, 0)).toEqual(['follow']);

    const tested = { manual: { status: 'test' as const, firedAt: 1000, endsAt: 1100 } };
    expect(getDueCues(cues, getCueSchedule(cues, resolved, tested, 0), tested, 1100, 0)).toEqual([]);
  });
});

describe('getNextCue()', () => {
  it('finds the first armed cue', () => {
    const cues = toCues(makeCue({ id: 'a' }), makeCue({ id: 'b', start: { trigger: 'event-go', eventId: 'e2' } }));
    const schedule = getCueSchedule(cues, resolveTimelineCues(cues, spans), {}, 0);
    expect(getNextCue(cues, schedule, {}, 0)).toBe('a');
    expect(getNextCue(cues, schedule, { a: { status: 'done', firedAt: 1000, endsAt: 1100 } }, 0)).toBe('b');
  });
});

describe('getEventGoCues()', () => {
  it('lists automatic cues on the GO of an event', () => {
    const cues = toCues(makeCue({ id: 'a' }), makeCue({ id: 'm', goMode: 'manual' }));
    expect(getEventGoCues(cues, 'e1')).toEqual(['a']);
  });
});

describe('fireCueEntry() and settleCuePlayback()', () => {
  it('runs a cue for its length and then marks it done', () => {
    const entry = fireCueEntry('a', { a: { start: 0, end: 100 } }, 500, 'running');
    expect(entry).toEqual({ status: 'running', firedAt: 500, endsAt: 600 });
    expect(settleCuePlayback({ a: entry }, 599).a.status).toBe('running');
    expect(settleCuePlayback({ a: entry }, 600).a.status).toBe('done');
  });

  it('marks a one-shot done straight away and forgets ended tests', () => {
    expect(fireCueEntry('a', { a: { start: 0, end: 0 } }, 500, 'running').status).toBe('done');
    const test = fireCueEntry('a', { a: { start: 0, end: 100 } }, 500, 'test');
    expect(settleCuePlayback({ a: test }, 700)).toEqual({});
  });

  it('keeps the same object when nothing changes', () => {
    const playback = { a: { status: 'done' as const, firedAt: 0, endsAt: 0 } };
    expect(settleCuePlayback(playback, 100)).toBe(playback);
  });
});

describe('isOneShotCue()', () => {
  it('is a cue with no length', () => {
    expect(isOneShotCue(makeCue({ id: 'a', end: { trigger: 'duration', duration: 0 } }))).toBe(true);
    expect(isOneShotCue(makeCue({ id: 'a' }))).toBe(false);
  });
});

describe('getNextCueInEvent()', () => {
  const cues = toCues(
    makeCue({ id: 'go', goMode: 'manual' }),
    makeCue({ id: 'inside', start: { trigger: 'inside-event', eventId: 'e1', offset: 500 } }),
    makeCue({ id: 'chained', start: { trigger: 'auto-follow', cueId: 'go', offset: 0 } }),
    makeCue({ id: 'other', start: { trigger: 'event-go', eventId: 'e2' } }),
  );
  const resolved = resolveTimelineCues(cues, spans);

  it('finds the first cue of the event which had no GO', () => {
    expect(getNextCueInEvent(cues, resolved, spans[0], {})).toBe('go');
    const played = { go: { status: 'running' as const, firedAt: 1000, endsAt: 1100 } };
    // the chained cue runs by itself
    expect(getNextCueInEvent(cues, resolved, spans[0], played)).toBe('inside');
  });

  it('is null once every cue of the event played', () => {
    const played = {
      go: { status: 'done' as const, firedAt: 1000, endsAt: 1100 },
      inside: { status: 'running' as const, firedAt: 1500, endsAt: 1600 },
    };
    expect(getNextCueInEvent(cues, resolved, spans[0], played)).toBeNull();
  });
});

describe('panicCuePlayback()', () => {
  it('stops running cues and forgets tests', () => {
    const playback = {
      a: { status: 'running' as const, firedAt: 0, endsAt: 1000 },
      b: { status: 'test' as const, firedAt: 0, endsAt: 1000 },
      c: { status: 'done' as const, firedAt: 0, endsAt: 100 },
    };
    expect(panicCuePlayback(playback, 500)).toEqual({
      a: { status: 'stopped', firedAt: 0, endsAt: 500 },
      c: playback.c,
    });
  });
});
