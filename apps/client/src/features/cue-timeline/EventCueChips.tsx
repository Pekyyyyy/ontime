import type { CustomFieldKey, EntryId } from 'ontime-types';
import { millisToString } from 'ontime-utils';
import { CSSProperties, MouseEvent } from 'react';

import useCustomFields from '../../common/hooks-query/useCustomFields';
import useRundown from '../../common/hooks-query/useRundown';
import { cx } from '../../common/utils/styleUtils';
import { getCuesByEvent, getEventCuesOnTrack } from './cuesByEvent';
import { getCueColour } from './cueTimeline.utils';
import { useCueSelection } from './useCueSelection';

import style from './EventCueChips.module.scss';

interface EventCueChipsProps {
  eventId: EntryId;
  /** only the cues of one custom field, eg: in its table column */
  track?: CustomFieldKey;
  /** hides the name of the lane, eg: when the column already tells it */
  hideTrack?: boolean;
  /** sits under the value of a table cell */
  inCell?: boolean;
  className?: string;
}

/**
 * The timeline cues which play during an event, as chips which open the cue for editing
 */
export default function EventCueChips({ eventId, track, hideTrack, inCell, className }: EventCueChipsProps) {
  const { data: rundown } = useRundown();
  const { data: customFields } = useCustomFields();
  const selectedCueId = useCueSelection((state) => state.selectedCueId);
  const setSelectedCueId = useCueSelection((state) => state.setSelectedCueId);
  const openCue = useCueSelection((state) => state.openCue);

  const byEvent = getCuesByEvent(rundown);
  const items = track ? getEventCuesOnTrack(byEvent, eventId, track) : (byEvent[eventId] ?? []);
  if (items.length === 0) return null;

  const select = (event: MouseEvent, cueId: string) => {
    // the cue opens for editing, not the event it sits in
    event.stopPropagation();
    setSelectedCueId(cueId);
  };

  return (
    <div className={cx([style.chips, inCell && style.inCell, className])} data-testid='event-cues'>
      {items.map(({ cue, isStart, offset }) => {
        const colour = getCueColour(cue, customFields[cue.track]?.colour);
        const when = isStart ? (offset > 0 ? `+${millisToString(offset)}` : 'GO') : 'cont.';
        return (
          <button
            key={cue.id}
            type='button'
            className={cx([style.chip, !isStart && style.carried, cue.id === selectedCueId && style.selected])}
            style={{ '--cue-colour': colour } as CSSProperties}
            title={`${customFields[cue.track]?.label ?? cue.track}: ${cue.label}${cue.note ? `\n${cue.note}` : ''}`}
            onClick={(event) => select(event, cue.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              openCue(cue.id);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {!hideTrack && <span className={style.track}>{customFields[cue.track]?.label ?? cue.track}</span>}
            <span className={style.label}>{cue.label || 'Untitled'}</span>
            <span className={style.when}>{when}</span>
          </button>
        );
      })}
    </div>
  );
}
