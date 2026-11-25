import { CustomFields, Rundown, TimelineCue } from 'ontime-types';

import { sendRefetch } from '../../../adapters/WebsocketAdapter.js';
import { makeOntimeEvent, makeRundown } from '../__mocks__/rundown.mocks.js';
import { getCurrentRundown, rundownCache } from '../rundown.dao.js';
import { parseRundown, parseTimelineCues } from '../rundown.parser.js';
import { deleteCustomField, deleteEntries, editCustomField, setTimelineCues } from '../rundown.service.js';

const storedRundowns: Record<string, Rundown> = {};

vi.mock('../../../services/teleprompter-service/teleprompter.service.js');
vi.mock('../../../classes/data-provider/DataProvider.js', () => ({
  getDataProvider: () => ({
    getRundown: (id: string) => {
      if (!storedRundowns[id]) throw new Error(`Rundown with id: ${id} not found`);
      return storedRundowns[id];
    },
    setRundown: vi.fn<(id: string, rundown: Rundown) => Promise<void>>(async (id, rundown) => {
      storedRundowns[id] = structuredClone(rundown);
    }),
    getProjectRundowns: () => storedRundowns,
    getCustomFields: () => ({}),
    setCustomFields: vi.fn<(customFields: CustomFields) => Promise<CustomFields>>(async (customFields) => customFields),
    getTeleprompterSettings: () => ({ script: null }),
    setTeleprompterSettings: vi.fn<() => Promise<void>>(),
  }),
}));
vi.mock('../../../adapters/WebsocketAdapter.js', () => ({ sendRefetch: vi.fn<typeof sendRefetch>() }));
vi.mock('../../../services/runtime-service/runtime.service.js', () => ({ runtimeService: { stop: vi.fn() } }));
vi.mock('../../../services/app-state-service/appState.service.js', () => ({
  setLastLoadedRundown: vi.fn<() => Promise<void>>(),
}));

const customFields: CustomFields = {
  camera: { type: 'text', colour: '#f00', label: 'camera' },
};

function makeCue(patch: Partial<TimelineCue> & Pick<TimelineCue, 'id'>): TimelineCue {
  return {
    track: 'camera',
    label: 'CAM1 on PGM',
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: 'a' },
    end: { trigger: 'duration', duration: 1000 },
    goMode: 'auto',
    followsDelay: true,
    ...patch,
  };
}

describe('timeline cues', () => {
  beforeEach(() => {
    for (const id of Object.keys(storedRundowns)) delete storedRundowns[id];
    const loaded = makeRundown({
      id: 'loaded',
      entries: {
        a: makeOntimeEvent({ id: 'a', timeStart: 0, timeEnd: 10_000, duration: 10_000 }),
        b: makeOntimeEvent({ id: 'b', timeStart: 10_000, timeEnd: 20_000, duration: 10_000 }),
        c: makeOntimeEvent({ id: 'c', timeStart: 20_000, timeEnd: 30_000, duration: 10_000 }),
      },
      order: ['a', 'b', 'c'],
      revision: 1,
    });
    storedRundowns[loaded.id] = structuredClone(loaded);
    rundownCache.init(loaded, customFields);
  });

  it('stores cues and drops the ones on unknown lanes', async () => {
    const result = await setTimelineCues('loaded', {
      one: makeCue({ id: 'one', end: { trigger: 'event-go', eventId: 'c' } }),
      two: makeCue({ id: 'two', track: 'unknown' }),
    });

    expect(Object.keys(result.cues ?? {})).toEqual(['one']);
    expect(getCurrentRundown().cues?.one.end).toEqual({ trigger: 'event-go', eventId: 'c' });
    expect(storedRundowns.loaded.cues?.one).toBeDefined();
  });

  it('keeps the place of cues whose events are deleted', async () => {
    await setTimelineCues('loaded', {
      one: makeCue({
        id: 'one',
        start: { trigger: 'inside-event', eventId: 'b', offset: 2000 },
        end: { trigger: 'event-go', eventId: 'c' },
      }),
    });

    await deleteEntries('loaded', ['b', 'c']);

    // with b and c gone, the time of the cue falls after event a
    expect(getCurrentRundown().cues?.one.start).toEqual({ trigger: 'inside-event', eventId: 'a', offset: 12_000 });
    expect(getCurrentRundown().cues?.one.end).toEqual({ trigger: 'inside-event', eventId: 'a', offset: 20_000 });
  });

  it('follows its custom field when renamed and goes with it when deleted', async () => {
    await setTimelineCues('loaded', { one: makeCue({ id: 'one' }) });

    await editCustomField('camera', { label: 'cams' });
    expect(getCurrentRundown().cues?.one.track).toBe('cams');

    await deleteCustomField('cams');
    expect(getCurrentRundown().cues).toBeUndefined();
  });
});

describe('parseTimelineCues()', () => {
  it('skips cues with invalid shapes', () => {
    const errors: string[] = [];
    const parsed = parseTimelineCues(
      {
        ok: {
          track: 'camera',
          start: { trigger: 'event-go', eventId: 'a' },
          end: { trigger: 'duration', duration: -5 },
        },
        noTrack: { start: { trigger: 'event-go', eventId: 'a' }, end: { trigger: 'duration', duration: 5 } },
        badTrigger: { track: 'camera', start: { trigger: 'whenever' }, end: { trigger: 'duration', duration: 5 } },
      },
      (message) => errors.push(message),
    );

    expect(parsed).toEqual({
      ok: {
        id: 'ok',
        track: 'camera',
        label: '',
        note: '',
        colour: '',
        start: { trigger: 'event-go', eventId: 'a' },
        end: { trigger: 'duration', duration: 0 },
        goMode: 'auto',
        followsDelay: true,
      },
    });
    expect(errors).toHaveLength(2);
  });

  it('is kept by the rundown parser when its references exist', () => {
    const rundown = makeRundown({
      entries: { a: makeOntimeEvent({ id: 'a' }) },
      order: ['a'],
      cues: {
        one: makeCue({ id: 'one' }),
        orphan: makeCue({ id: 'orphan', start: { trigger: 'event-go', eventId: 'gone' } }),
      },
    });
    expect(Object.keys(parseRundown(rundown, customFields).cues ?? {})).toEqual(['one']);
  });
});
