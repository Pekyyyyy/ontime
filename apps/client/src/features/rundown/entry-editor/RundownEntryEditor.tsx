import { OntimeEntry, isOntimeEvent, isOntimeGroup, isOntimeMilestone } from 'ontime-types';
import { useEffect, useMemo, useRef } from 'react';

import useRundown from '../../../common/hooks-query/useRundown';
import { AppMode } from '../../../ontimeConfig';
import SelectedCueEditor from '../../cue-timeline/SelectedCueEditor';
import { useCueSelection } from '../../cue-timeline/useCueSelection';
import { useEditorFollowMode } from '../useEditorFollowMode';
import { useEventSelection } from '../useEventSelection';
import EventEditorFooter from './composite/EventEditorFooter';
import { getEditTarget } from './entryEditor.utils';
import EventEditor from './EventEditor';
import EventEditorEmpty from './EventEditorEmpty';
import GroupEditor from './GroupEditor';
import MilestoneEditor from './MilestoneEditor';

import style from './EntryEditor.module.scss';

export default function RundownEntryEditor() {
  const selectedEvents = useEventSelection((state) => state.selectedEvents);
  const cursor = useEventSelection((state) => state.cursor);
  const { data } = useRundown();
  const { editorMode } = useEditorFollowMode();
  const selectedCueId = useCueSelection((state) => state.selectedCueId);
  const setSelectedCueId = useCueSelection((state) => state.setSelectedCueId);

  // picking an event edits it, in place of the cue
  const lastSelection = useRef(selectedEvents);
  useEffect(() => {
    if (lastSelection.current === selectedEvents) return;
    lastSelection.current = selectedEvents;
    setSelectedCueId(null);
  }, [selectedEvents, setSelectedCueId]);

  const entry = useMemo<OntimeEntry | null>(() => {
    if (data.order.length === 0) {
      return null;
    }

    return getEditTarget(selectedEvents, cursor, data.entries);
  }, [data.order.length, data.entries, selectedEvents, cursor]);

  // a selected cue is edited here, its timeline leaves the editing to this panel
  if (selectedCueId && data.cues?.[selectedCueId] && editorMode === AppMode.Edit) {
    return (
      <div className={style.rundownEditor} data-testid='editor-container'>
        <SelectedCueEditor />
      </div>
    );
  }

  if (!entry) {
    return <EventEditorEmpty />;
  }

  if (isOntimeEvent(entry)) {
    return (
      <div className={style.rundownEditor} data-testid='editor-container'>
        <EventEditor event={entry} />
        <EventEditorFooter id={entry.id} cue={entry.cue} />
      </div>
    );
  }

  if (isOntimeMilestone(entry)) {
    return (
      <div className={style.rundownEditor} data-testid='editor-container'>
        <MilestoneEditor milestone={entry} />
      </div>
    );
  }

  if (isOntimeGroup(entry)) {
    return (
      <div className={style.rundownEditor} data-testid='editor-container'>
        <GroupEditor group={entry} />
      </div>
    );
  }

  return null;
}
