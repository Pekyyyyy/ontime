import {
  CuePlayback,
  LogOrigin,
  Playback,
  Rundown,
  RundownCues,
  TimelineCueId,
  TimerLifeCycle,
  isOntimeEvent,
} from 'ontime-types';
import {
  type CueSchedule,
  type ResolvedTimelineCues,
  type TimelineEventSpan,
  dayInMs,
  fireCueEntry,
  getCueSchedule,
  getDueCues,
  getEventAtTime,
  getEventGoCues,
  getNextCue,
  getNextCueInEvent,
  getTimelineEventSpans,
  isChainedCue,
  panicCuePlayback,
  resolveTimelineCues,
  settleCuePlayback,
} from 'ontime-utils';

import { type CueAutomationData, triggerCueAutomations } from '../../api-data/automation/automation.service.js';
import * as logger from '../../api-data/logs/logs.service.js';
import { getCurrentRundown, getProjectCustomFields } from '../../api-data/rundown/rundown.dao.js';
import * as timeCore from '../../lib/time-core/timeCore.js';
import { eventStore } from '../../stores/EventStore.js';
import { getState } from '../../stores/runtimeState.js';
import { runtimeService } from '../runtime-service/runtime.service.js';

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
  /** gives the next event its GO, for cues which move the show on */
  startNextEvent: () => void;
  /** a cue had its GO or a test, eg: to run its automations */
  onCueFired?: (cueId: TimelineCueId, status: 'running' | 'test') => void;
  /** a panic stopped the running cues */
  onPanic?: () => void;
};

/** a GO of the next event which a cue asked for */
type PendingEventGo = { cueId: TimelineCueId; at: number; eventId: string };

export class CueCommandError extends Error {}

/**
 * Runs the timeline cues of the loaded rundown
 * - automatic cues fire on time, or with the GO of their event
 * - chained cues fire after, or with, the cue they follow
 * - manual cues wait for a GO, a cue which ran needs a rearm to run again
 * - tests run a cue without its chain and without marking it as played
 */
export function createCueService({
  getRundown,
  getRuntime,
  emit,
  log,
  startNextEvent,
  onCueFired,
  onPanic,
}: CueServiceDeps) {
  let state: CuePlayback = { rundownId: null, cues: {} };
  let cache: {
    id: string;
    revision: number;
    cues: RundownCues;
    spans: TimelineEventSpan[];
    resolved: ResolvedTimelineCues;
  } | null = null;
  let lastEventNowId: string | null = null;
  let lastPlayback: Playback | null = null;
  let pendingEventGo: PendingEventGo[] = [];

  function getCues() {
    const rundown = getRundown();
    if (!cache || cache.id !== rundown.id || cache.revision !== rundown.revision) {
      const cues = rundown.cues ?? {};
      const spans = getTimelineEventSpans(rundown);
      cache = { id: rundown.id, revision: rundown.revision, cues, spans, resolved: resolveTimelineCues(cues, spans) };
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
    const entry = fireCueEntry(cueId, schedule, runtime.now, status);
    state = { ...state, cues: { ...state.cues, [cueId]: entry } };
    log(status === 'test' ? 'Cue test' : 'Cue GO', cue.label);
    onCueFired?.(cueId, status);

    // a test does not move the show on
    if (status === 'running' && cue.nextEvent && runtime.eventNowId) {
      const base = cue.nextEvent.trigger === 'auto-continue' ? entry.firedAt : entry.endsAt;
      pendingEventGo.push({ cueId, at: base + cue.nextEvent.offset, eventId: runtime.eventNowId });
    }
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
      pendingEventGo = [];
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
    moveShowOn(runtime);
  }

  /**
   * Gives the next event its GO once a cue asked for it
   * The request lapses when the show moved on by itself, or its cue stopped or was rearmed
   */
  function moveShowOn(runtime: CueRuntimeInput) {
    if (pendingEventGo.length === 0) return;
    pendingEventGo = pendingEventGo.filter((pending) => {
      const entry = state.cues[pending.cueId];
      return pending.eventId === runtime.eventNowId && (entry?.status === 'running' || entry?.status === 'done');
    });
    const due = pendingEventGo.find((pending) => runtime.now >= pending.at);
    if (!due) return;
    pendingEventGo = [];
    log('Cue GO next event', getCues().cues[due.cueId]?.label ?? due.cueId);
    startNextEvent();
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

  /**
   * The operator's Next: plays the next cue of the running event
   * @returns false when every cue of the event had its GO, and the show should move to the next event
   */
  function goNextInEvent(): boolean {
    state = reconcile();
    const runtime = getRuntime();
    if (!runtime.eventNowId) return false;
    const { cues, spans, resolved } = getCues();
    const span = spans.find((candidate) => candidate.id === runtime.eventNowId);
    if (!span) return false;
    const cueId = getNextCueInEvent(cues, resolved, span, state.cues);
    if (!cueId) return false;
    go(cueId);
    return true;
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

  /** stops every running cue, they and their chains stay stopped until a rearm */
  function panic() {
    state = reconcile();
    const stopped = panicCuePlayback(state.cues, getRuntime().now);
    pendingEventGo = [];
    if (stopped !== state.cues) {
      state = { ...state, cues: stopped };
      log('Cue panic', 'all running cues');
    }
    onPanic?.();
    flush();
  }

  function rearmAll() {
    state = { ...reconcile(), cues: {} };
    pendingEventGo = [];
    flush();
  }

  return {
    update,
    go,
    goNext,
    goNextInEvent,
    test,
    rearm,
    rearmAll,
    panic,
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
  startNextEvent: () => runtimeService.startNext(),
  onCueFired: (cueId, status) => {
    const data = getCueAutomationData(cueId, status);
    if (data) triggerCueAutomations(TimerLifeCycle.onCueGo, data);
  },
  onPanic: () => triggerCueAutomations(TimerLifeCycle.onCuePanic),
});

/**
 * What an automation can read about a cue: its own fields and the event it plays in
 */
function getCueAutomationData(cueId: TimelineCueId, status: 'running' | 'test'): CueAutomationData | null {
  const rundown = getCurrentRundown();
  const cue = rundown.cues?.[cueId];
  if (!cue) return null;
  const spans = getTimelineEventSpans(rundown);
  const times = resolveTimelineCues(rundown.cues ?? {}, spans)[cueId];
  const span = times ? getEventAtTime(spans, times.start) : null;
  const entry = span ? rundown.entries[span.id] : undefined;
  const event = entry && isOntimeEvent(entry) ? entry : null;
  return {
    id: cue.id,
    label: cue.label,
    note: cue.note,
    track: cue.track,
    trackLabel: getProjectCustomFields()[cue.track]?.label ?? cue.track,
    status: status === 'test' ? 'test' : 'go',
    event: event ? { id: event.id, cue: event.cue, title: event.title, custom: { ...event.custom } } : null,
  };
}

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
