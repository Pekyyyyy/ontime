import type { EntryId, OntimeEntry } from './OntimeEntry.js';
import type { RundownCues } from './TimelineCue.type.js';

export type RundownEntries = Record<EntryId, OntimeEntry>;

type RundownId = string;
export type ProjectRundowns = Record<RundownId, Rundown>;

export type Rundown = {
  id: RundownId;
  title: string;
  order: EntryId[];
  flatOrder: EntryId[];
  entries: RundownEntries;
  revision: number;
  /** timeline cues on the custom field lanes, missing in projects made before cues existed */
  cues?: RundownCues;
};
