import CueTimeline from '../cue-timeline/CueTimeline';
import { useCueTimelinePanel } from '../cue-timeline/useCueTimelinePanel';
import { useEditorFollowMode } from './useEditorFollowMode';

import style from './RundownExport.module.scss';

interface RundownCueViewProps {
  /** the side panel edits the selected cue, without it the timeline does */
  hasSidePanel?: boolean;
}

/**
 * The rundown shown as a timeline of its cues, next to the list and the table
 */
export default function RundownCueView({ hasSidePanel }: RundownCueViewProps) {
  const { orientation, setOrientation } = useCueTimelinePanel('rundown', 'horizontal');
  const { editorMode } = useEditorFollowMode();

  return (
    <CueTimeline
      orientation={orientation}
      onOrientationChange={setOrientation}
      mode={editorMode}
      showInspector={!hasSidePanel}
      className={style.cueView}
    />
  );
}
