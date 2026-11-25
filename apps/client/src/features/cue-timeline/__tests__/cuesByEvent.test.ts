import type { OntimeEvent, Rundown, TimelineCue } from 'ontime-types';
import { SupportedEntry } from 'ontime-types';

import { getCuesByEvent, getEventCuesOnTrack } from '../cuesByEvent';

function makeEvent(id: string, timeStart: number, duration: number) {
  return {
    id,
    type: SupportedEntry.Event,
    timeStart,
    timeEnd: timeStart + duration,
    duration,
    dayOffset: 0,
  } as OntimeEvent;
}

function makeCue(patch: Partial<TimelineCue> & Pick<TimelineCue, 'id'>): TimelineCue {
  return {
    track: 'camera',
    label: patch.id,
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: 'e1' },
    end: { trigger: 'duration', duration: 1000 },
    goMode: 'auto',
    followsDelay: true,
    ...patch,
  };
}

describe('getCuesByEvent()', () => {
  const rundown = {
    flatOrder: ['e1', 'e2'],
    entries: { e1: makeEvent('e1', 0, 1000), e2: makeEvent('e2', 1000, 1000) },
    cues: {
      long: makeCue({ id: 'long', end: { trigger: 'duration', duration: 1500 } }),
      late: makeCue({ id: 'late', track: 'light', start: { trigger: 'inside-event', eventId: 'e1', offset: 500 } }),
      shot: makeCue({
        id: 'shot',
        start: { trigger: 'event-go', eventId: 'e2' },
        end: { trigger: 'duration', duration: 0 },
      }),
    },
  } as unknown as Pick<Rundown, 'flatOrder' | 'entries' | 'cues'>;

  it('lists the cues which start in an event and the ones carrying on through it', () => {
    const byEvent = getCuesByEvent(rundown);
    expect(byEvent.e1.map((item) => [item.cue.id, item.isStart, item.offset])).toEqual([
      ['long', true, 0],
      ['late', true, 500],
    ]);
    expect(byEvent.e2.map((item) => [item.cue.id, item.isStart])).toEqual([
      ['long', false],
      ['late', false],
      ['shot', true],
    ]);
  });

  it('filters the cues of a custom field', () => {
    expect(getEventCuesOnTrack(getCuesByEvent(rundown), 'e1', 'light').map((item) => item.cue.id)).toEqual(['late']);
  });
});
