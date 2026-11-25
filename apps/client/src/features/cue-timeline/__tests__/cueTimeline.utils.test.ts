import type { CustomFields, RundownCues, TimelineCue } from 'ontime-types';
import { resolveTimelineCues } from 'ontime-utils';

import {
  dragCue,
  dragEvent,
  makeCueAt,
  makeCueBetween,
  makeTimelineModelFromSpans,
  removeCue,
  snapToGrid,
} from '../cueTimeline.utils';

const spans = [
  { id: 'e1', start: 600_000, end: 1_200_000 },
  { id: 'e2', start: 1_200_000, end: 1_800_000 },
];

const customFields: CustomFields = {
  camera: { type: 'text', colour: '#f00', label: 'Camera' },
  image: { type: 'image', colour: '', label: 'Image' },
  lights: { type: 'text', colour: '', label: 'Lights' },
};

function makeCue(patch: Partial<TimelineCue> & Pick<TimelineCue, 'id'>): TimelineCue {
  return {
    track: 'camera',
    label: patch.id,
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: 'e1' },
    end: { trigger: 'duration', duration: 60_000 },
    goMode: 'auto',
    followsDelay: true,
    ...patch,
  };
}

describe('makeTimelineModelFromSpans()', () => {
  it('makes a lane for each text custom field, stacking rows', () => {
    const cues: RundownCues = {
      a: makeCue({ id: 'a' }),
      b: makeCue({ id: 'b', start: { trigger: 'auto-continue', cueId: 'a', offset: 0 } }),
    };
    const model = makeTimelineModelFromSpans(spans, cues, customFields);
    expect(model.tracks.map((track) => [track.key, track.firstRow, track.rowCount])).toEqual([
      ['camera', 0, 2],
      ['lights', 2, 1],
    ]);
    expect(model.totalRows).toBe(3);
    expect(model.rangeStart).toBe(300_000);
    expect(model.rangeEnd).toBe(2_100_000);
  });
});

describe('dragCue()', () => {
  const cue = makeCue({ id: 'a', end: { trigger: 'event-go', eventId: 'e2' } });
  const context = { spans, resolved: resolveTimelineCues({ a: cue }, spans), snap: 0 };

  it('moves both ends of a cue', () => {
    expect(dragCue(cue, 'move', 60_000, context)).toMatchObject({
      start: { trigger: 'inside-event', eventId: 'e1', offset: 60_000 },
      end: { trigger: 'inside-event', eventId: 'e2', offset: 60_000 },
    });
  });

  it('resizes from either edge', () => {
    expect(dragCue(cue, 'start', 30_000, context).start).toEqual({
      trigger: 'inside-event',
      eventId: 'e1',
      offset: 30_000,
    });
    expect(dragCue(cue, 'end', 600_000, context).end).toEqual({
      trigger: 'inside-event',
      eventId: 'e2',
      offset: 600_000,
    });
  });

  it('keeps the end of a cue with a duration in place when the start moves', () => {
    const timed = makeCue({ id: 'b' });
    const timedContext = { spans, resolved: resolveTimelineCues({ b: timed }, spans), snap: 0 };
    expect(dragCue(timed, 'start', 20_000, timedContext).end).toEqual({ trigger: 'duration', duration: 40_000 });
  });
});

describe('dragEvent()', () => {
  const event = { id: 'e1', timeStart: 600_000, timeEnd: 1_200_000, duration: 600_000 };

  it('moves an event and unlinks it', () => {
    expect(dragEvent(event, 'move', 60_000)).toEqual({
      id: 'e1',
      timeStart: 660_000,
      timeEnd: 1_260_000,
      duration: 600_000,
      linkStart: false,
    });
  });

  it('does not make a negative duration', () => {
    expect(dragEvent(event, 'end', -900_000).duration).toBe(0);
    expect(dragEvent(event, 'start', 900_000).duration).toBe(0);
  });
});

describe('makeCueAt()', () => {
  it('starts at the time inside the event and ends at the next event GO', () => {
    const cue = makeCueAt('camera', 700_000, spans, 0);
    expect(cue?.start).toEqual({ trigger: 'inside-event', eventId: 'e1', offset: 100_000 });
    expect(cue?.end).toEqual({ trigger: 'event-go', eventId: 'e2' });
  });
});

describe('removeCue()', () => {
  it('keeps linked cues in place', () => {
    const cues: RundownCues = {
      a: makeCue({ id: 'a' }),
      b: makeCue({ id: 'b', start: { trigger: 'auto-follow', cueId: 'a', offset: 0 } }),
    };
    const result = removeCue(cues, 'a', spans, resolveTimelineCues(cues, spans));
    expect(Object.keys(result)).toEqual(['b']);
    expect(result.b.start).toEqual({ trigger: 'inside-event', eventId: 'e1', offset: 60_000 });
  });
});

describe('snapToGrid()', () => {
  it('rounds to the grid', () => {
    expect(snapToGrid(1_499, 1000)).toBe(1000);
    expect(snapToGrid(1_500, 1000)).toBe(2000);
    expect(snapToGrid(1_234, 0)).toBe(1_234);
  });
});

describe('makeCueBetween()', () => {
  it('starts with the event at its start and lasts as long as it was drawn', () => {
    const cue = makeCueBetween('camera', 600_000, 900_000, spans, 0);
    expect(cue?.start).toEqual({ trigger: 'event-go', eventId: 'e1' });
    expect(cue?.end).toEqual({ trigger: 'duration', duration: 300_000 });
    expect(cue?.goMode).toBe('auto');
  });

  it('starts inside an event when drawn after its GO', () => {
    const cue = makeCueBetween('camera', 700_000, 1_300_000, spans, 0);
    expect(cue?.start).toEqual({ trigger: 'inside-event', eventId: 'e1', offset: 100_000 });
    expect(cue?.end).toEqual({ trigger: 'duration', duration: 600_000 });
  });

  it('ignores a click without a drag', () => {
    expect(makeCueBetween('camera', 700_000, 700_200, spans, 0)).toBeNull();
  });
});
