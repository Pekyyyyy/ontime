import { CuePlayback, LogOrigin, Playback, Rundown, RundownCues, TimelineCueId, isOntimeEvent } from 'ontime-types';
import {
  type CueSchedule,
  type ResolvedTimelineCues,
  dayInMs,
  fireCueEntry,
  getCueSchedule,
  getDueCues,
  getEventGoCues,
  getNextCue,
  getTimelineEventSpans,
  isChainedCue,
  resolveTimelineCues,
  settleCuePlayback,
} from 'ontime-utils';

import * as logger from '../../api-data/logs/logs.service.js';
import { getCurrentRundown } from '../../api-data/rundown/rundown.dao.js';
import * as timeCore from '../../lib/time-core/timeCore.js';
import { eventStore } from '../../stores/EventStore.js';
import { getState } from '../../stores/runtimeState.js';

export type CueRuntimeInput = {
  /** now, along the timeline: time of day plus the day of the show */
  now: number;
  /** the running delay, positive when behind */
  delay: number;
  playback: Playback;
  eventNowId: string | null;
};

type CueServiceDeps = {
  getRundown: () => Pick<Rundown, 'id' | 'revision' | 'flatOrder' | 'entries' | 'cues'>;
  getRuntime: () => CueRuntimeInput;
  emit: (playback: CuePlayback) => void;
  log: (message: string, cueLabel: string) => void;
};

export class CueCommandError extends Error {}

/**
 * Runs the timeline cues of the loaded rundown
 * - automatic cues fire on time, or with the GO of their event
 * - chained cues fire after, or with, the cue they follow
 * - manual cues wait for a GO, a cue which ran needs a rearm to run again
 * - tests run a cue without its chain and without marking it as played
 */
export function createCueService({ getRundown, getRuntime, emit, log }: CueServiceDeps) {
  let state: CuePlayback = { rundownId: null, cues: {} };
  let cache: { id: string; revision: number; cues: RundownCues; resolved: ResolvedTimelineCues } | null = null;
  let lastEventNowId: string | null = null;
  let lastPlayback: Playback | null = null;

  function getCues() {
    const rundown = getRundown();
    if (!cache || cache.id !== rundown.id || cache.revision !== rundown.revision) {
      const cues = rundown.cues ?? {};
      cache = {
        id: rundown.id,
        revision: rundown.revision,
        cues,
        resolved: resolveTimelineCues(cues, getTimelineEventSpans(rundown)),
      };
    }
    return cache;
  }

  function getSchedule(runtime: CueRuntimeInput): { cues: RundownCues; schedule: CueSchedule } {
    const { cues, resolved } = getCues();
    return { cues, schedule: getCueSchedule(cues, resolved, state.cues, runtime.delay) };
  }

  let published: CuePlayback = state;

  /** publishes the state when a command or an update changed it */
  function flush() {
    if (state === published) return;
    published = state;
    emit(state);
  }

  /** forgets what belongs to another rundown, or to cues which no longer exist */
  function reconcile(): CuePlayback {
    const { id, cues } = getCues();
    if (state.rundownId !== id) return { rundownId: id, cues: {} };
    let changed = false;
    const entries: CuePlayback['cues'] = {};
    for (const cueId in state.cues) {
      if (cues[cueId]) entries[cueId] = state.cues[cueId];
      else changed = true;
    }
    return changed ? { ...state, cues: entries } : state;
  }

  function fire(cueId: TimelineCueId, status: 'running' | 'test', runtime: CueRuntimeInput) {
    const { cues, schedule } = getSchedule(runtime);
    const cue = cues[cueId];
    if (!cue) return;
    state = { ...state, cues: { ...state.cues, [cueId]: fireCueEntry(cueId, schedule, runtime.now, status) } };
    log(status === 'test' ? 'Cue test' : 'Cue GO', cue.label);
  }

  /**
   * Brings the cues in step with the clock and the runtime, runs often
   */
  function update() {
    const runtime = getRuntime();
    state = reconcile();

    // a stopped show starts over with every cue armed
    if (runtime.playback === Playback.Stop && lastPlayback !== null && lastPlayback !== Playback.Stop) {
      state = { ...state, cues: {} };
    }

    const isRunning = runtime.playback === Playback.Play || runtime.playback === Playback.Roll;
    // the GO of an event fires its automatic cues, whatever the clock says
    if (
      isRunning &&
      runtime.eventNowId &&
      (runtime.eventNowId !== lastEventNowId || lastPlayback !== runtime.playback)
    ) {
      for (const cueId of getEventGoCues(getCues().cues, runtime.eventNowId)) {
        if (!state.cues[cueId]) fire(cueId, 'running', runtime);
      }
    }

    // a cue which fires can make its chain due, so we look again, a chain cannot be longer than the cues
    // chains follow a GO at any time, cues on the clock only fire while the show runs
    for (let i = 0; i <= Object.keys(getCues().cues).length; i++) {
      const { cues, schedule } = getSchedule(runtime);
      const due = getDueCues(cues, schedule, state.cues, runtime.now).filter(
        (cueId) => isRunning || isChainedCue(cues[cueId]),
      );
      if (due.length === 0) break;
      for (const cueId of due) fire(cueId, 'running', runtime);
    }

    const settled = settleCuePlayback(state.cues, runtime.now);
    if (settled !== state.cues) state = { ...state, cues: settled };

    lastEventNowId = runtime.eventNowId;
    lastPlayback = runtime.playback;
    flush();
  }

  function go(cueId: TimelineCueId) {
    state = reconcile();
    const { cues } = getCues();
    if (!cues[cueId]) throw new CueCommandError(`Cue ${cueId} not found`);
    const entry = state.cues[cueId];
    if (entry && entry.status !== 'test') throw new CueCommandError('Cue already played, rearm it first');
    fire(cueId, 'running', getRuntime());
    // its chain may be due already
    update();
  }

  function goNext() {
    state = reconcile();
    const runtime = getRuntime();
    const { cues, schedule } = getSchedule(runtime);
    const cueId = getNextCue(cues, schedule, state.cues, runtime.now);
    if (!cueId) throw new CueCommandError('No cue waiting');
    go(cueId);
  }

  function test(cueId: TimelineCueId) {
    state = reconcile();
    if (!getCues().cues[cueId]) throw new CueCommandError(`Cue ${cueId} not found`);
    fire(cueId, 'test', getRuntime());
    flush();
  }

  function rearm(cueId: TimelineCueId) {
    state = reconcile();
    if (state.cues[cueId]) {
      const cues = { ...state.cues };
      delete cues[cueId];
      state = { ...state, cues };
    }
    flush();
  }

  function rearmAll() {
    state = { ...reconcile(), cues: {} };
    flush();
  }

  return {
    update,
    go,
    goNext,
    test,
    rearm,
    rearmAll,
    getState: () => state,
  };
}

function getRuntimeInput(): CueRuntimeInput {
  const runtime = getState();
  const day = runtime.rundown.currentDay ?? 0;
  const delay = runtime.offset.mode === 'absolute' ? runtime.offset.absolute : runtime.offset.relative;
  return {
    now: timeCore.timeOfDayNow() + day * dayInMs,
    delay: runtime.timer.playback === Playback.Stop ? 0 : delay,
    playback: runtime.timer.playback,
    eventNowId: runtime.eventNow && isOntimeEvent(runtime.eventNow) ? runtime.eventNow.id : null,
  };
}

export const cueService = createCueService({
  getRundown: getCurrentRundown,
  getRuntime: getRuntimeInput,
  emit: (playback) => eventStore.set('cuePlayback', playback),
  log: (message, cueLabel) => logger.info(LogOrigin.Playback, message, { cue: cueLabel }),
});

let interval: NodeJS.Timeout | null = null;

/**
 * Starts following the clock, often enough for cues to fire close to their time
 */
export function initCueService() {
  if (interval) clearInterval(interval);
  cueService.update();
  interval = setInterval(() => {
    try {
      cueService.update();
    } catch (error) {
      logger.error(LogOrigin.Playback, 'Cue update failed', { error: String(error) });
    }
  }, 100);
  interval.unref?.();
}
