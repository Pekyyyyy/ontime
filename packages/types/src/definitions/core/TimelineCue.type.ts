import type { CustomFieldKey } from './CustomFields.type.js';
import type { EntryId } from './OntimeEntry.js';

export type TimelineCueId = string;

/**
 * What makes a timeline cue start
 * - event-go: the cue fires with the GO of an event
 * - inside-event: the cue fires with a GO at a planned offset inside an event
 * - auto-follow: the cue fires when another cue ends, after an optional wait
 * - auto-continue: the cue fires together with another cue, after an optional wait
 */
export type TimelineCueStart =
  | { trigger: 'event-go'; eventId: EntryId }
  | { trigger: 'inside-event'; eventId: EntryId; offset: number }
  | { trigger: 'auto-follow'; cueId: TimelineCueId; offset: number }
  | { trigger: 'auto-continue'; cueId: TimelineCueId; offset: number };

/**
 * What makes a timeline cue end
 * - duration: the cue runs for a fixed time after it starts
 * - event-go: the cue ends with the GO of an event, which may be several events later
 * - inside-event: the cue ends with a GO at a planned offset inside an event
 */
export type TimelineCueEnd =
  | { trigger: 'duration'; duration: number }
  | { trigger: 'event-go'; eventId: EntryId }
  | { trigger: 'inside-event'; eventId: EntryId; offset: number };

export type TimelineCueStartTrigger = TimelineCueStart['trigger'];
export type TimelineCueEndTrigger = TimelineCueEnd['trigger'];

/**
 * A cue on a timeline lane, eg: a camera on PGM, a lighting state or a QLab cue
 * Each lane is a custom field of the project
 */
export type TimelineCue = {
  id: TimelineCueId;
  /** the custom field which this cue belongs to */
  track: CustomFieldKey;
  label: string;
  note: string;
  /** an empty string uses the colour of the custom field */
  colour: string;
  start: TimelineCueStart;
  end: TimelineCueEnd;
};

export type RundownCues = Record<TimelineCueId, TimelineCue>;
