import { useLocalStorage } from '@mantine/hooks';

import type { TimelineOrientation } from './cueTimeline.utils';

/**
 * Remembers, per surface, whether the cue timeline is shown and which way time runs
 */
export function useCueTimelinePanel(surface: 'cuesheet' | 'editor', defaultOrientation: TimelineOrientation) {
  const [isOpen, setOpen] = useLocalStorage<boolean>({
    key: `cue-timeline-${surface}-open`,
    defaultValue: surface === 'editor',
  });
  const [orientation, setOrientation] = useLocalStorage<TimelineOrientation>({
    key: `cue-timeline-${surface}-orientation`,
    defaultValue: defaultOrientation,
  });

  return { isOpen, setOpen, orientation, setOrientation };
}
