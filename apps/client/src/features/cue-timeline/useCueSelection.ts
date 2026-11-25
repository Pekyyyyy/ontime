import type { TimelineCueId } from 'ontime-types';
import { create } from 'zustand';

type CueSelectionStore = {
  selectedCueId: TimelineCueId | null;
  setSelectedCueId: (cueId: TimelineCueId | null) => void;
};

/**
 * The cue being edited, shared by the timeline and the panel which edits it
 */
export const useCueSelection = create<CueSelectionStore>((set) => ({
  selectedCueId: null,
  setSelectedCueId: (selectedCueId) => set({ selectedCueId }),
}));
