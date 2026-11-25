import {
  CustomFieldKey,
  CustomFields,
  DatabaseModel,
  Day,
  EntryId,
  OntimeEntry,
  OntimeEvent,
  OntimeGroup,
  OntimeMilestone,
  PlayableEvent,
  ProjectRundowns,
  Rundown,
  RundownCues,
  RundownEntries,
  TimelineCue,
  TimelineCueEnd,
  TimelineCueStart,
  isOntimeDelay,
  isOntimeEvent,
  isOntimeGroup,
  isOntimeMilestone,
  isPlayableEvent,
} from 'ontime-types';
import {
  createDelay,
  createEvent,
  createGroup,
  createMilestone,
  generateId,
  getLinkedTimes,
  getTimelineEventSpans,
  getTimeFrom,
  isNewLatest,
  isObjectEmpty,
  sanitiseTimelineCues,
} from 'ontime-utils';

import { makeNewRundown } from '../../models/dataModel.js';
import type { ErrorEmitter } from '../../utils/parserUtils.js';
import { RundownMetadata } from './rundown.types.js';
import { calculateDayOffset, cleanupCustomFields, cloneEntryData } from './rundown.utils.js';

/**
 * Parse a rundowns object along with the project custom fields
 * Returns a default rundown if none exists
 */
export function parseRundowns(
  data: Partial<DatabaseModel>,
  parsedCustomFields: Readonly<CustomFields>,
  emitError?: ErrorEmitter,
): ProjectRundowns {
  // ensure there is always a rundown to import
  // this is important since the rest of the app assumes this exist
  if (!data.rundowns || isObjectEmpty(data.rundowns)) {
    emitError?.('No data found to import');
    const defaultRundown = makeNewRundown();
    return {
      [defaultRundown.id]: defaultRundown,
    };
  }

  const parsedRundowns: ProjectRundowns = {};
  const iterableRundownsIds = Object.keys(data.rundowns);

  // parse all the rundowns individually
  for (const id of iterableRundownsIds) {
    const rundown = data.rundowns[id];
    const parsedRundown = parseRundown(rundown, parsedCustomFields, emitError);
    parsedRundowns[parsedRundown.id] = parsedRundown;
  }

  return parsedRundowns;
}

/**
 * Parses and validates a single project rundown along with given project custom fields
 */
export function parseRundown(
  rundown: Rundown,
  parsedCustomFields: Readonly<CustomFields>,
  emitError?: ErrorEmitter,
): Rundown {
  const parsedRundown: Rundown = {
    id: rundown.id || generateId(),
    // Preserve existing names; title validation applies when creating or renaming a rundown.
    title: typeof rundown.title === 'string' ? rundown.title : 'untitled',
    entries: {},
    order: [],
    flatOrder: [],
    revision: rundown.revision ?? 1,
  };

  let eventIndex = 0;

  for (let i = 0; i < rundown.order.length; i++) {
    const entryId = rundown.order[i];
    const event = rundown.entries[entryId];

    if (!event) {
      emitError?.('Could not find referenced event, skipping');
      continue;
    }

    // an entry has one place in the rundown, the first one found
    if (Object.hasOwn(parsedRundown.entries, entryId) || Object.hasOwn(parsedRundown.entries, event.id)) {
      emitError?.('ID collision on event import, skipping');
      continue;
    }

    const id = entryId;
    let newEvent: OntimeEntry | null;
    const nestedEntryIds: string[] = [];

    if (isOntimeEvent(event)) {
      newEvent = createEvent(event, eventIndex);
      // skip if event is invalid
      if (newEvent == null) {
        emitError?.('Skipping event without payload');
        continue;
      }

      cleanupCustomFields(newEvent.custom, parsedCustomFields);
      eventIndex += 1;
    } else if (isOntimeDelay(event)) {
      newEvent = createDelay({ duration: event.duration, id });
    } else if (isOntimeMilestone(event)) {
      newEvent = createMilestone({ ...event, id });
      cleanupCustomFields(newEvent.custom, parsedCustomFields);
      /**
       * We leave here an entry point for blocks for the alpha testers, should remove this after a while
       */
      // @ts-expect-error -- we are checking a legacy type
    } else if (event.type === 'block' || isOntimeGroup(event)) {
      for (let i = 0; i < event.entries.length; i++) {
        const nestedEventId = event.entries[i];
        const nestedEvent = rundown.entries[nestedEventId];
        if (Object.hasOwn(parsedRundown.entries, nestedEventId)) {
          emitError?.('ID collision on event import, skipping');
          continue;
        }
        let newNestedEvent: OntimeEntry | null = null;

        if (isOntimeEvent(nestedEvent)) {
          newNestedEvent = createEvent(nestedEvent, eventIndex);

          // skip if event is invalid
          if (newNestedEvent == null) {
            emitError?.('Skipping event without payload');
            continue;
          }

          newNestedEvent.parent = event.id;
          cleanupCustomFields(newNestedEvent.custom, parsedCustomFields);
          eventIndex += 1;
        } else if (isOntimeDelay(nestedEvent)) {
          newNestedEvent = createDelay({ duration: nestedEvent.duration, id: nestedEventId });
          newNestedEvent.parent = event.id;
        } else if (isOntimeMilestone(nestedEvent)) {
          newNestedEvent = createMilestone({ ...nestedEvent, id: nestedEventId });
          newNestedEvent.parent = event.id;
          cleanupCustomFields(newNestedEvent.custom, parsedCustomFields);
        }

        if (newNestedEvent) {
          nestedEntryIds.push(nestedEventId);
          parsedRundown.entries[nestedEventId] = newNestedEvent;
        }
      }

      newEvent = createGroup({ ...structuredClone(event), id });
      // a group lists only the entries parsed into it
      newEvent.entries = nestedEntryIds;
      // ensure custom fields are valid
      cleanupCustomFields(newEvent.custom, parsedCustomFields);
    } else {
      emitError?.('Unknown event type, skipping');
      continue;
    }

    if (newEvent) {
      parsedRundown.entries[id] = newEvent;
      parsedRundown.order.push(id);
      parsedRundown.flatOrder.push(id);
      parsedRundown.flatOrder.push(...nestedEntryIds);
    }
  }

  const cues = sanitiseTimelineCues(
    parseTimelineCues(rundown.cues, emitError),
    getTimelineEventSpans(parsedRundown),
    parsedCustomFields,
  );
  if (!isObjectEmpty(cues)) {
    parsedRundown.cues = cues;
  }

  return parsedRundown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function parseCueStart(value: unknown): TimelineCueStart | null {
  if (!isRecord(value)) return null;
  switch (value.trigger) {
    case 'event-go':
      return isId(value.eventId) ? { trigger: 'event-go', eventId: value.eventId } : null;
    case 'inside-event':
      return isId(value.eventId)
        ? { trigger: 'inside-event', eventId: value.eventId, offset: parseOffset(value.offset) }
        : null;
    case 'auto-follow':
    case 'auto-continue':
      return isId(value.cueId)
        ? { trigger: value.trigger, cueId: value.cueId, offset: parseOffset(value.offset) }
        : null;
    default:
      return null;
  }
}

function parseCueEnd(value: unknown): TimelineCueEnd | null {
  if (!isRecord(value)) return null;
  switch (value.trigger) {
    case 'duration':
      return { trigger: 'duration', duration: parseOffset(value.duration) };
    case 'event-go':
      return isId(value.eventId) ? { trigger: 'event-go', eventId: value.eventId } : null;
    case 'inside-event':
      return isId(value.eventId)
        ? { trigger: 'inside-event', eventId: value.eventId, offset: parseOffset(value.offset) }
        : null;
    default:
      return null;
  }
}

/**
 * Parses the shape of untrusted timeline cues
 * References are not checked here, see sanitiseTimelineCues
 */
export function parseTimelineCues(data: unknown, emitError?: ErrorEmitter): RundownCues {
  const cues: RundownCues = {};
  if (data === undefined) return cues;
  if (!isRecord(data)) {
    emitError?.('Timeline cues are not an object, skipping');
    return cues;
  }

  for (const key in data) {
    const raw = data[key];
    if (!isRecord(raw) || !isId(raw.track)) {
      emitError?.('Skipping invalid timeline cue');
      continue;
    }
    const start = parseCueStart(raw.start);
    const end = parseCueEnd(raw.end);
    if (!start || !end) {
      emitError?.('Skipping timeline cue with invalid triggers');
      continue;
    }
    const cue: TimelineCue = {
      id: key,
      track: raw.track,
      label: typeof raw.label === 'string' ? raw.label : '',
      note: typeof raw.note === 'string' ? raw.note : '',
      colour: typeof raw.colour === 'string' ? raw.colour : '',
      start,
      end,
    };
    cues[key] = cue;
  }
  return cues;
}

/**
 * Ensures that custom fields have references
 * If a field is exists in the entry but not in the project customFields, it is deleted
 * Mutates the given event in place
 */
export function sanitiseCustomFields(customFields: CustomFields, entry: OntimeEvent | OntimeMilestone | OntimeGroup) {
  for (const field in entry.custom) {
    if (field in customFields) continue;
    delete entry.custom[field];
  }
  return entry;
}

export type ProcessedRundownMetadata = RundownMetadata & {
  entries: RundownEntries;
  order: EntryId[];
  previousEvent: PlayableEvent | null; // The playableEvent from the previous iteration
  latestEvent: PlayableEvent | null; // The playableEvent most forwards in time processed so far
  previousEntry: OntimeEntry | null; // The entry processed in the previous iteration
  assignedCustomFields: Record<CustomFieldKey, string[]>; // Custom fields assigned to events
};

/**
 * Factory function to create a rundown metadata processor
 *
 * @param customFields project custom fields used to sanitise entries
 * @param options.mutate when true, entries are mutated in place rather than cloned.
 *                      Callers must own (or have already cloned) the input rundown.
 * @returns process() - processes entries in order | getMetadata() returns the accumulated metadata
 */
export function makeRundownMetadata(customFields: CustomFields, options?: { mutate?: boolean }) {
  const mutate = options?.mutate ?? false;
  const rundownMeta: ProcessedRundownMetadata = {
    totalDelay: 0,
    totalDuration: 0,
    totalDays: 0,
    firstStart: null,
    lastEnd: null,

    assignedCustomFields: {},
    playableEventOrder: [],
    timedEventOrder: [],
    flatEntryOrder: [],
    flags: [],

    entries: {},
    order: [],
    previousEvent: null,
    latestEvent: null,
    previousEntry: null,
  };

  function process<T extends OntimeEntry>(entry: T, childOfGroup: EntryId | null): T {
    return processEntry(rundownMeta, customFields, mutate ? entry : cloneEntryData(entry), childOfGroup);
  }

  function getMetadata(): ProcessedRundownMetadata {
    return rundownMeta;
  }

  return { process, getMetadata };
}

/**
 * Processes a single entry, mutating both `entry` and `rundownMetadata` in place.
 * Returns the same `entry` reference for caller convenience.
 */
function processEntry<T extends OntimeEntry>(
  rundownMetadata: ProcessedRundownMetadata,
  customFields: CustomFields,
  entry: T,
  childOfGroup: EntryId | null,
): T {
  rundownMetadata.flatEntryOrder.push(entry.id);

  if (isOntimeEvent(entry)) {
    rundownMetadata.timedEventOrder.push(entry.id);

    /**
     * 1.Checks that link can be established (ie, events exist and are valid)
     * and populates the time data from link
     * The linked event is always the previous playable event
     * If no previous event exists, the link is removed
     */
    if (entry.linkStart) {
      if (rundownMetadata.previousEvent) {
        const timePatch = getLinkedTimes(entry, rundownMetadata.previousEvent);
        entry.timeStart = timePatch.timeStart;
        entry.timeEnd = timePatch.timeEnd;
        entry.duration = timePatch.duration;
      } else {
        entry.linkStart = false;
      }
    }

    // 2. handle custom fields - mutates entry
    sanitiseCustomFields(customFields, entry);

    /*
     * we initialise data so that is not calculated for skipped events
     * consider especially the day offset, while skipped events have no
     * day offset, we match it to the previous element to avoid
     * pushing confusing data to the UI
     */
    entry.dayOffset = (rundownMetadata.previousEvent?.dayOffset ?? 0) as Day;
    entry.delay = 0;
    entry.gap = 0;

    entry.parent = childOfGroup;

    // update rundown metadata, it only concerns playable events
    if (isPlayableEvent(entry)) {
      rundownMetadata.totalDays += calculateDayOffset(entry, rundownMetadata.previousEvent);
      entry.dayOffset = rundownMetadata.totalDays as Day;
      rundownMetadata.playableEventOrder.push(entry.id);

      // first start is always the first event
      if (rundownMetadata.firstStart === null) {
        rundownMetadata.firstStart = entry.timeStart;
      }

      // check if event is flagged
      if (entry.flag) {
        rundownMetadata.flags.push(entry.id);
      }

      entry.gap = getTimeFrom(entry, rundownMetadata.latestEvent);

      if (entry.gap === 0) {
        // event starts on previous finish, we add its duration
        rundownMetadata.totalDuration += entry.duration;
      } else if (entry.gap > 0) {
        // event has a gap, we add the gap and the duration
        rundownMetadata.totalDuration += entry.gap + entry.duration;
      } else {
        // there is an overlap, we remove the overlap from the duration
        // ensuring that the sum is not negative (ie: fully overlapped events)
        // NOTE: we add the gap since it is a negative number
        rundownMetadata.totalDuration += Math.max(entry.duration + entry.gap, 0);
      }

      // remove eventual gaps from the accumulated delay
      // we only affect positive delays (time forwards)
      if (rundownMetadata.totalDelay > 0 && entry.gap > 0) {
        let correctedDelay = 0;
        // we need to separate the delay that is accumulated from one that may exist after the gap
        if (isOntimeDelay(rundownMetadata.previousEntry)) {
          correctedDelay = rundownMetadata.previousEntry.duration;
          rundownMetadata.totalDelay -= correctedDelay;
        }
        rundownMetadata.totalDelay = Math.max(rundownMetadata.totalDelay - entry.gap, 0);
        rundownMetadata.totalDelay += correctedDelay;
      }

      // current event delay is the current accumulated delay
      entry.delay = rundownMetadata.totalDelay;

      // assign data for next iteration
      rundownMetadata.previousEvent = entry;

      // lastEntry is the event with the latest end time
      if (isNewLatest(entry, rundownMetadata.latestEvent)) {
        rundownMetadata.latestEvent = entry;
        rundownMetadata.lastEnd = entry.timeEnd;
      }
    }
  } else if (isOntimeDelay(entry)) {
    // !!! this must happen after handling the links
    rundownMetadata.totalDelay += entry.duration;
    entry.parent = childOfGroup;
  }

  if (!childOfGroup) {
    rundownMetadata.order.push(entry.id);
  }
  rundownMetadata.entries[entry.id] = entry;
  rundownMetadata.previousEntry = entry;

  return entry;
}
