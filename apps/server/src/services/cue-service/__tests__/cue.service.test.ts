import { CuePlayback, Playback, RundownCues, TimelineCue } from 'ontime-types';

import { makeOntimeEvent, makeRundown } from '../../../api-data/rundown/__mocks__/rundown.mocks.js';
import { CueRuntimeInput, createCueService } from '../cue.service.js';

vi.mock('../../../api-data/logs/logs.service.js');
vi.mock('../../../stores/EventStore.js', () => ({ eventStore: { set: vi.fn() } }));

function makeCue(patch: Partial<TimelineCue> & Pick<TimelineCue, 'id'>): TimelineCue {
  return {
    track: 'camera',
    label: patch.id,
    note: '',
    colour: '',
    start: { trigger: 'event-go', eventId: 'a' },
    end: { trigger: 'duration', duration: 1000 },
    goMode: 'auto',
    followsDelay: true,
    ...patch,
  };
}

function setup(cues: RundownCues, initial: Partial<CueRuntimeInput> = {}) {
  const rundown = makeRundown({
    id: 'r1',
    entries: {
      a: makeOntimeEvent({ id: 'a', timeStart: 10_000, timeEnd: 20_000, duration: 10_000 }),
      b: makeOntimeEvent({ id: 'b', timeStart: 20_000, timeEnd: 30_000, duration: 10_000 }),
    },
    order: ['a', 'b'],
    cues,
  });
  const runtime: CueRuntimeInput = { now: 0, delay: 0, playback: Playback.Stop, eventNowId: null, ...initial };
  const emitted: CuePlayback[] = [];
  const service = createCueService({
    getRundown: () => rundown,
    getRuntime: () => runtime,
    emit: (playback) => emitted.push(playback),
    log: () => {},
  });
  return { service, runtime, emitted };
}

describe('cue service', () => {
  it('fires automatic cues with the GO of their event and runs their chain', () => {
    const { service, runtime } = setup({
      one: makeCue({ id: 'one' }),
      follow: makeCue({ id: 'follow', start: { trigger: 'auto-follow', cueId: 'one', offset: 500 } }),
      manual: makeCue({ id: 'manual', goMode: 'manual' }),
    });

    // the show started a little late
    Object.assign(runtime, { now: 12_000, delay: 2000, playback: Playback.Play, eventNowId: 'a' });
    service.update();
    expect(service.getState().cues.one).toEqual({ status: 'running', firedAt: 12_000, endsAt: 13_000 });
    expect(service.getState().cues.manual).toBeUndefined();

    runtime.now = 13_500;
    service.update();
    expect(service.getState().cues.one.status).toBe('done');
    expect(service.getState().cues.follow).toEqual({ status: 'running', firedAt: 13_500, endsAt: 14_500 });
  });

  it('needs a rearm to GO a cue again', () => {
    const { service } = setup({ manual: makeCue({ id: 'manual', goMode: 'manual' }) });
    service.go('manual');
    expect(() => service.go('manual')).toThrow('rearm');
    service.rearm('manual');
    expect(service.getState().cues.manual).toBeUndefined();
    service.go('manual');
    expect(service.getState().cues.manual.status).toBe('running');
  });

  it('tests a cue without its chain', () => {
    const { service, runtime } = setup({
      one: makeCue({ id: 'one', goMode: 'manual' }),
      with: makeCue({ id: 'with', start: { trigger: 'auto-continue', cueId: 'one', offset: 0 } }),
    });
    service.test('one');
    service.update();
    expect(service.getState().cues.one.status).toBe('test');
    expect(service.getState().cues.with).toBeUndefined();

    // a test ends by itself and leaves the cue armed
    runtime.now = 5000;
    service.update();
    expect(service.getState().cues).toEqual({});
  });

  it('runs the chain of a GO even when the show is not running', () => {
    const { service } = setup({
      one: makeCue({ id: 'one', goMode: 'manual' }),
      with: makeCue({ id: 'with', start: { trigger: 'auto-continue', cueId: 'one', offset: 0 } }),
    });
    service.go('one');
    expect(service.getState().cues.with.status).toBe('running');
  });

  it('goes to the next waiting cue, and rearms everything when the show stops', () => {
    const { service, runtime } = setup({
      first: makeCue({ id: 'first', goMode: 'manual' }),
      second: makeCue({ id: 'second', goMode: 'manual', start: { trigger: 'event-go', eventId: 'b' } }),
    });
    service.goNext();
    service.goNext();
    expect(Object.keys(service.getState().cues)).toEqual(['first', 'second']);
    expect(() => service.goNext()).toThrow('No cue waiting');

    runtime.playback = Playback.Play;
    service.update();
    runtime.playback = Playback.Stop;
    service.update();
    expect(service.getState().cues).toEqual({});
  });

  it('only publishes when something changed', () => {
    const { service, emitted } = setup({ manual: makeCue({ id: 'manual', goMode: 'manual' }) });
    service.update();
    const count = emitted.length;
    service.update();
    expect(emitted.length).toBe(count);
  });

  it('plays the cues of the running event on Next, then lets the show move on', () => {
    const { service, runtime } = setup({
      first: makeCue({ id: 'first', goMode: 'manual', start: { trigger: 'inside-event', eventId: 'a', offset: 1000 } }),
      second: makeCue({
        id: 'second',
        goMode: 'manual',
        start: { trigger: 'inside-event', eventId: 'a', offset: 5000 },
      }),
      later: makeCue({ id: 'later', goMode: 'manual', start: { trigger: 'event-go', eventId: 'b' } }),
    });
    Object.assign(runtime, { now: 10_500, playback: Playback.Play, eventNowId: 'a' });

    expect(service.goNextInEvent()).toBe(true);
    expect(service.getState().cues.first.status).toBe('running');
    expect(service.goNextInEvent()).toBe(true);
    expect(service.getState().cues.second.status).toBe('running');
    expect(service.goNextInEvent()).toBe(false);
    expect(service.getState().cues.later).toBeUndefined();
  });

  it('stops running cues on panic, and their chain does not run', () => {
    const { service, runtime } = setup({
      one: makeCue({ id: 'one', goMode: 'manual' }),
      follow: makeCue({ id: 'follow', start: { trigger: 'auto-follow', cueId: 'one', offset: 0 } }),
    });
    Object.assign(runtime, { now: 10_000, playback: Playback.Play, eventNowId: 'a' });
    service.go('one');
    runtime.now = 10_200;
    service.panic();
    expect(service.getState().cues.one).toEqual({ status: 'stopped', firedAt: 10_000, endsAt: 10_200 });

    runtime.now = 12_000;
    service.update();
    expect(service.getState().cues.follow).toBeUndefined();
    expect(() => service.go('one')).toThrow('rearm');
  });
});
