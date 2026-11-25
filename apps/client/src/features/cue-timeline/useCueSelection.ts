import type { TimelineCueId } from 'ontime-types';
import { create } from 'zustand';

type CueSelectionStore = {
  selectedCueId: TimelineCueId | null;
  /** a cue opened for editing whose editor should take the focus, cleared once it has */
  focusCueId: TimelineCueId | null;
  setSelectedCueId: (cueId: TimelineCueId | null) => void;
  /** selects a cue and asks its editor to take the focus, eg: on a double-click */
  openCue: (cueId: TimelineCueId) => void;
  clearFocusRequest: () => void;
};

/**
 * The cue being edited, shared by the timeline and the panel which edits it
 */
export const useCueSelection = create<CueSelectionStore>((set) => ({
  selectedCueId: null,
  focusCueId: null,
  setSelectedCueId: (selectedCueId) => set({ selectedCueId }),
  openCue: (cueId) => set({ selectedCueId: cueId, focusCueId: cueId }),
  clearFocusRequest: () => set({ focusCueId: null }),
}));
