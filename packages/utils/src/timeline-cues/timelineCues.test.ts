import type { CustomFields, RundownCues, TimelineCue } from 'ontime-types';

import {
  anchorEndAt,
  anchorStartAt,
  getEventAtTime,
  layoutTimelineCues,
  renameTimelineCueTrack,
  resolveTimelineCues,
  sanitiseTimelineCues,
  wouldCreateCycle,
  type TimelineEventSpan,
} from './timelineCues.js';

const spans: TimelineEventSpan[] = [
  { id: 'e1', start: 0, end: 100 },
  { id: 'e2', start: 100, end: 200 },
  { id: 'e3', start: 300, end: 400 },
];

const customFields: CustomFields = {
  camera: { type: 'text', colour: '', label: 'camera' },
  light: { type: 'text', colour: '', label: 'light' },
};

function makeCue(patch: Partial<TimelineCue> & Pick<TimelineCue, 'id'>): TimelineCue {
  return {
    track: 'camera',
    label: patch.id,
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: 'e1' },
    end: { trigger: 'duration', duration: 50 },
    goMode: 'auto',
    followsDelay: true,
    ...patch,
  };
}

function toCues(...cues: TimelineCue[]): RundownCues {
  return Object.fromEntries(cues.map((cue) => [cue.id, cue]));
}

describe('resolveTimelineCues()', () => {
  it('resolves every kind of start and end', () => {
    const cues = toCues(
      makeCue({ id: 'go' }),
      makeCue({ id: 'inside', start: { trigger: 'inside-event', eventId: 'e2', offset: 20 } }),
      makeCue({ id: 'follow', start: { trigger: 'auto-follow', cueId: 'go', offset: 10 } }),
      makeCue({ id: 'continue', start: { trigger: 'auto-continue', cueId: 'inside', offset: 5 } }),
      makeCue({ id: 'span', end: { trigger: 'event-go', eventId: 'e3' } }),
      makeCue({ id: 'spanInside', end: { trigger: 'inside-event', eventId: 'e3', offset: 50 } }),
    );

    expect(resolveTimelineCues(cues, spans)).toEqual({
      go: { start: 0, end: 50 },
      inside: { start: 120, end: 170 },
      follow: { start: 60, end: 110 },
      continue: { start: 125, end: 175 },
      span: { start: 0, end: 300 },
      spanInside: { start: 0, end: 350 },
    });
  });

  it('leaves out cues with missing or circular references', () => {
    const cues = toCues(
      makeCue({ id: 'missingEvent', start: { trigger: 'event-go', eventId: 'nope' } }),
      makeCue({ id: 'missingCue', start: { trigger: 'auto-follow', cueId: 'nope', offset: 0 } }),
      makeCue({ id: 'a', start: { trigger: 'auto-follow', cueId: 'b', offset: 0 } }),
      makeCue({ id: 'b', start: { trigger: 'auto-continue', cueId: 'a', offset: 0 } }),
      makeCue({ id: 'ok' }),
    );
    expect(resolveTimelineCues(cues, spans)).toEqual({ ok: { start: 0, end: 50 } });
  });

  it('does not let a cue end before it starts', () => {
    const cues = toCues(
      makeCue({
        id: 'backwards',
        start: { trigger: 'event-go', eventId: 'e3' },
        end: { trigger: 'event-go', eventId: 'e1' },
      }),
    );
    expect(resolveTimelineCues(cues, spans)).toEqual({ backwards: { start: 300, end: 300 } });
  });
});

describe('getEventAtTime()', () => {
  it('finds the event that holds a time, or the one before a gap', () => {
    expect(getEventAtTime(spans, 150)?.id).toBe('e2');
    expect(getEventAtTime(spans, 250)?.id).toBe('e2');
    expect(getEventAtTime(spans, -10)?.id).toBe('e1');
    expect(getEventAtTime([], 0)).toBeNull();
  });
});

describe('anchorStartAt()', () => {
  const resolved = { ref: { start: 100, end: 150 } };

  it('re-anchors event triggers to the event under the time, snapping to a GO', () => {
    const start = { trigger: 'event-go', eventId: 'e1' } as const;
    expect(anchorStartAt(start, 130, { spans, resolved })).toEqual({
      trigger: 'inside-event',
      eventId: 'e2',
      offset: 30,
    });
    expect(anchorStartAt(start, 305, { spans, resolved, snap: 10 })).toEqual({ trigger: 'event-go', eventId: 'e3' });
    expect(anchorStartAt(start, 100, { spans, resolved })).toEqual({ trigger: 'event-go', eventId: 'e2' });
  });

  it('turns moves of linked cues into waits', () => {
    expect(anchorStartAt({ trigger: 'auto-follow', cueId: 'ref', offset: 0 }, 170, { spans, resolved })).toEqual({
      trigger: 'auto-follow',
      cueId: 'ref',
      offset: 20,
    });
    expect(anchorStartAt({ trigger: 'auto-continue', cueId: 'ref', offset: 0 }, 90, { spans, resolved })).toEqual({
      trigger: 'auto-continue',
      cueId: 'ref',
      offset: 0,
    });
  });
});

describe('anchorEndAt()', () => {
  it('keeps the kind of end trigger', () => {
    const options = { spans, resolved: {} };
    expect(anchorEndAt({ trigger: 'duration', duration: 10 }, 80, 20, options)).toEqual({
      trigger: 'duration',
      duration: 60,
    });
    expect(anchorEndAt({ trigger: 'event-go', eventId: 'e1' }, 320, 20, options)).toEqual({
      trigger: 'inside-event',
      eventId: 'e3',
      offset: 20,
    });
    expect(anchorEndAt({ trigger: 'duration', duration: 10 }, 0, 20, options)).toEqual({
      trigger: 'duration',
      duration: 0,
    });
  });
});

describe('sanitiseTimelineCues()', () => {
  it('removes cues of deleted custom fields', () => {
    const cues = toCues(makeCue({ id: 'a', track: 'gone' }), makeCue({ id: 'b' }));
    expect(Object.keys(sanitiseTimelineCues(cues, spans, customFields))).toEqual(['b']);
  });

  it('re-anchors cues of deleted events at their previous time', () => {
    const cues = toCues(
      makeCue({
        id: 'a',
        start: { trigger: 'inside-event', eventId: 'deleted', offset: 10 },
        end: { trigger: 'event-go', eventId: 'deleted2' },
      }),
    );
    const result = sanitiseTimelineCues(cues, spans, customFields, { a: { start: 110, end: 300 } });
    expect(result.a.start).toEqual({ trigger: 'inside-event', eventId: 'e2', offset: 10 });
    expect(result.a.end).toEqual({ trigger: 'event-go', eventId: 'e3' });
  });

  it('removes cues of deleted events when their time is unknown', () => {
    const cues = toCues(makeCue({ id: 'a', start: { trigger: 'event-go', eventId: 'deleted' } }));
    expect(sanitiseTimelineCues(cues, spans, customFields)).toEqual({});
  });

  it('breaks loops', () => {
    const cues = toCues(
      makeCue({ id: 'a', start: { trigger: 'auto-follow', cueId: 'b', offset: 0 } }),
      makeCue({ id: 'b', start: { trigger: 'auto-follow', cueId: 'a', offset: 0 } }),
    );
    const result = sanitiseTimelineCues(cues, spans, customFields, { a: { start: 0, end: 10 } });
    expect(result.a.start).toEqual({ trigger: 'event-go', eventId: 'e1' });
    expect(result.b.start).toEqual({ trigger: 'auto-follow', cueId: 'a', offset: 0 });
  });

  it('does not mutate the given cues', () => {
    const cues = toCues(makeCue({ id: 'a', track: 'gone' }));
    const copy = structuredClone(cues);
    sanitiseTimelineCues(cues, spans, customFields);
    expect(cues).toEqual(copy);
  });
});

describe('wouldCreateCycle()', () => {
  it('detects a loop through a chain of links', () => {
    const cues = toCues(
      makeCue({ id: 'a' }),
      makeCue({ id: 'b', start: { trigger: 'auto-follow', cueId: 'a', offset: 0 } }),
      makeCue({ id: 'c', start: { trigger: 'auto-continue', cueId: 'b', offset: 0 } }),
    );
    expect(wouldCreateCycle(cues, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(cues, 'c', 'a')).toBe(false);
  });
});

describe('renameTimelineCueTrack()', () => {
  it('moves the cues of a lane', () => {
    const cues = toCues(makeCue({ id: 'a' }), makeCue({ id: 'b', track: 'light' }));
    const result = renameTimelineCueTrack(cues, 'camera', 'cam');
    expect(result.a.track).toBe('cam');
    expect(result.b.track).toBe('light');
    expect(cues.a.track).toBe('camera');
  });
});

describe('layoutTimelineCues()', () => {
  it('stacks overlapping and auto-continue cues in rows', () => {
    const cues = toCues(
      makeCue({ id: 'a' }),
      makeCue({ id: 'b', start: { trigger: 'auto-continue', cueId: 'a', offset: 0 } }),
      makeCue({ id: 'c', start: { trigger: 'auto-follow', cueId: 'a', offset: 0 } }),
      makeCue({ id: 'd', track: 'light' }),
    );
    const resolved = resolveTimelineCues(cues, spans);
    expect(layoutTimelineCues(cues, resolved, ['camera', 'light'])).toEqual({
      rows: { a: 0, b: 1, c: 0, d: 0 },
      rowCount: { camera: 2, light: 1 },
    });
  });
});

describe('sanitiseTimelineCues() with one-shot cues', () => {
  it('turns an auto-continue from a one-shot cue into an auto-follow', () => {
    const cues = toCues(
      makeCue({ id: 'shot', end: { trigger: 'duration', duration: 0 } }),
      makeCue({ id: 'b', start: { trigger: 'auto-continue', cueId: 'shot', offset: 20 } }),
    );
    expect(sanitiseTimelineCues(cues, spans, customFields).b.start).toEqual({
      trigger: 'auto-follow',
      cueId: 'shot',
      offset: 20,
    });
  });
});

describe('cues which start an event', () => {
  it('end the wait before its GO when the event follows them', () => {
    const cues = toCues(makeCue({ id: 'a', nextEvent: { trigger: 'auto-follow', offset: 10, eventId: 'e3' } }));
    expect(resolveTimelineCues(cues, spans).a).toEqual({ start: 240, end: 290 });
  });

  it('start the wait before its GO when the event continues with them', () => {
    const cues = toCues(makeCue({ id: 'a', nextEvent: { trigger: 'auto-continue', offset: 10, eventId: 'e3' } }));
    expect(resolveTimelineCues(cues, spans).a).toEqual({ start: 290, end: 340 });
  });

  it('stay in place when the event they start is deleted', () => {
    const cues = toCues(makeCue({ id: 'a', nextEvent: { trigger: 'auto-follow', offset: 0, eventId: 'gone' } }));
    const result = sanitiseTimelineCues(cues, spans, customFields, { a: { start: 150, end: 200 } });
    expect(result.a.nextEvent).toEqual({ trigger: 'auto-follow', offset: 0 });
    expect(result.a.start).toEqual({ trigger: 'inside-event', eventId: 'e2', offset: 50 });
  });
});
