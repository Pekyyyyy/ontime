import { OntimeEvent, RundownCues, TimelineCueId, isOntimeEvent } from 'ontime-types';
import { getTimelineEventSpans } from 'ontime-utils';
import { useMemo } from 'react';

import useCustomFields from '../../common/hooks-query/useCustomFields';
import useRundown from '../../common/hooks-query/useRundown';
import CueInspector from './CueInspector';
import { makeTimelineModelFromSpans, removeCue } from './cueTimeline.utils';
import { useCueSelection } from './useCueSelection';
import { useTimelineCueActions } from './useTimelineCueActions';

/**
 * Edits the selected cue, outside of the timeline, eg: in the side panel of the editor
 * @returns null when no cue is selected
 */
export default function SelectedCueEditor() {
  const { data: rundown } = useRundown();
  const { data: customFields } = useCustomFields();
  const { setCues } = useTimelineCueActions();
  const selectedCueId = useCueSelection((state) => state.selectedCueId);
  const setSelectedCueId = useCueSelection((state) => state.setSelectedCueId);

  const cues = useMemo<RundownCues>(() => rundown.cues ?? {}, [rundown.cues]);
  const model = useMemo(
    () => makeTimelineModelFromSpans(getTimelineEventSpans(rundown), cues, customFields),
    [rundown, cues, customFields],
  );
  const eventLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const id of rundown.flatOrder) {
      const entry = rundown.entries[id];
      if (entry && isOntimeEvent(entry)) labels[id] = getEventLabel(entry);
    }
    return labels;
  }, [rundown.flatOrder, rundown.entries]);

  const cue = selectedCueId ? cues[selectedCueId] : undefined;
  if (!cue) return null;

  return (
    <CueInspector
      key={cue.id}
      cue={cue}
      cues={cues}
      model={model}
      eventLabels={eventLabels}
      eventOrder={model.spans.map((span) => span.id)}
      onChange={(next: RundownCues, selectId?: TimelineCueId) => {
        void setCues(next);
        if (selectId) setSelectedCueId(selectId);
      }}
      onDelete={() => {
        void setCues(removeCue(cues, cue.id, model.spans, model.resolved));
        setSelectedCueId(null);
      }}
      onClose={() => setSelectedCueId(null)}
    />
  );
}

function getEventLabel(event: OntimeEvent) {
  return event.cue ? `${event.cue} ${event.title}` : event.title;
}
