import type {
  EntryId,
  RundownCues,
  TimelineCue,
  TimelineCueEndTrigger,
  TimelineCueId,
  TimelineCueStartTrigger,
} from 'ontime-types';
import { makeEnd, makeStart, millisToString, parseUserTime, wouldCreateCycle } from 'ontime-utils';
import { useState } from 'react';
import { IoClose, IoTrash } from 'react-icons/io5';
import { LuArrowRightFromLine, LuLink2 } from 'react-icons/lu';

import Button from '../../common/components/buttons/Button';
import IconButton from '../../common/components/buttons/IconButton';
import Input from '../../common/components/input/input/Input';
import Select from '../../common/components/select/Select';
import { TimelineModel, makeLinkedCue } from './cueTimeline.utils';

import style from './CueTimeline.module.scss';

const startOptions: { value: TimelineCueStartTrigger; label: string }[] = [
  { value: 'event-go', label: 'Event GO' },
  { value: 'inside-event', label: 'GO inside event' },
  { value: 'auto-follow', label: 'After cue (auto-follow)' },
  { value: 'auto-continue', label: 'With cue (auto-continue)' },
];

const endOptions: { value: TimelineCueEndTrigger; label: string }[] = [
  { value: 'duration', label: 'Duration' },
  { value: 'event-go', label: 'Event GO' },
  { value: 'inside-event', label: 'GO inside event' },
];

interface CueInspectorProps {
  cue: TimelineCue;
  cues: RundownCues;
  model: TimelineModel;
  eventLabels: Record<EntryId, string>;
  eventOrder: EntryId[];
  onChange: (cues: RundownCues, selectId?: TimelineCueId) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function CueInspector({
  cue,
  cues,
  model,
  eventLabels,
  eventOrder,
  onChange,
  onDelete,
  onClose,
}: CueInspectorProps) {
  const times = model.resolved[cue.id];
  const options = { spans: model.spans, resolved: model.resolved };

  const update = (patch: Partial<TimelineCue>) => onChange({ ...cues, [cue.id]: { ...cue, ...patch } });

  // cues this one can link to, without making a loop
  const linkCandidates = Object.values(cues)
    .filter((candidate) => candidate.id !== cue.id && model.resolved[candidate.id])
    .filter((candidate) => !wouldCreateCycle(cues, cue.id, candidate.id))
    .sort((a, b) => model.resolved[a.id].start - model.resolved[b.id].start);

  const eventOptions = eventOrder.map((id) => ({ value: id, label: eventLabels[id] || id }));
  const cueOptions = linkCandidates.map((candidate) => ({
    value: candidate.id,
    label: candidate.label || candidate.id,
  }));
  const trackOptions = model.tracks.map((track) => ({ value: track.key, label: track.label }));

  const setStartTrigger = (trigger: TimelineCueStartTrigger) => {
    if (!times) return;
    let cueId: TimelineCueId | undefined;
    if (trigger === 'auto-follow') {
      // the cue which ends closest before this one starts
      cueId = [...linkCandidates].reverse().find((candidate) => model.resolved[candidate.id].end <= times.start)?.id;
    } else if (trigger === 'auto-continue') {
      cueId = [...linkCandidates].reverse().find((candidate) => model.resolved[candidate.id].start <= times.start)?.id;
    }
    cueId ??= linkCandidates[0]?.id;
    const start = makeStart(trigger, times.start, { cueId }, options);
    if (start) update({ start });
  };

  const setStartReference = (reference: string) => {
    if (!times) return;
    const isCue = cue.start.trigger === 'auto-follow' || cue.start.trigger === 'auto-continue';
    const start = makeStart(
      cue.start.trigger,
      times.start,
      isCue ? { cueId: reference } : { eventId: reference },
      options,
    );
    if (!start) return;
    // keep the offset the user set, the reference moved
    if ('offset' in start && 'offset' in cue.start) start.offset = cue.start.offset;
    update({ start });
  };

  const setStartOffset = (offset: number) => {
    if (!('offset' in cue.start)) return;
    update({ start: { ...cue.start, offset } });
  };

  const setEndTrigger = (trigger: TimelineCueEndTrigger) => {
    if (!times) return;
    const end = makeEnd(trigger, times.end, times.start, {}, options);
    if (end) update({ end });
  };

  const setEndReference = (eventId: EntryId) => {
    if (!times || cue.end.trigger === 'duration') return;
    const end = makeEnd(cue.end.trigger, times.end, times.start, { eventId }, options);
    if (!end) return;
    if ('offset' in end && 'offset' in cue.end) end.offset = cue.end.offset;
    update({ end });
  };

  const setEndTime = (value: number) => {
    if (cue.end.trigger === 'duration') update({ end: { trigger: 'duration', duration: value } });
    if (cue.end.trigger === 'inside-event') update({ end: { ...cue.end, offset: value } });
  };

  const addLinked = (trigger: 'auto-follow' | 'auto-continue') => {
    const linked = makeLinkedCue(cue, trigger, model.resolved);
    onChange({ ...cues, [linked.id]: linked }, linked.id);
  };

  const startReference = 'eventId' in cue.start ? cue.start.eventId : cue.start.cueId;
  const isCueStart = cue.start.trigger === 'auto-follow' || cue.start.trigger === 'auto-continue';

  return (
    <div className={style.inspector} data-testid='cue-inspector'>
      <div className={style.inspectorHeader}>
        <span>Cue</span>
        <IconButton aria-label='Close cue editor' size='small' variant='subtle-white' onClick={onClose}>
          <IoClose />
        </IconButton>
      </div>

      <label className={style.field}>
        Name
        <TextField key={cue.label} value={cue.label} onSubmit={(label) => update({ label })} />
      </label>
      <label className={style.field}>
        Lane
        <Select options={trackOptions} value={cue.track} onValueChange={(track) => track && update({ track })} fluid />
      </label>
      <label className={style.field}>
        Note
        <TextField key={cue.note} value={cue.note} onSubmit={(note) => update({ note })} />
      </label>

      <div className={style.fieldGroup}>
        <span className={style.groupTitle}>Starts</span>
        <Select
          aria-label='Start trigger'
          options={startOptions.map((option) => ({
            ...option,
            disabled: (option.value === 'auto-follow' || option.value === 'auto-continue') && cueOptions.length === 0,
          }))}
          value={cue.start.trigger}
          onValueChange={(trigger) => trigger && setStartTrigger(trigger)}
          fluid
        />
        <Select
          aria-label={isCueStart ? 'Start cue' : 'Start event'}
          options={isCueStart ? cueOptions : eventOptions}
          value={startReference}
          onValueChange={(reference) => reference && setStartReference(reference)}
          fluid
        />
        {'offset' in cue.start && (
          <label className={style.inlineField}>
            {isCueStart ? 'Wait' : 'GO at'}
            <TimeField key={cue.start.offset} value={cue.start.offset} onSubmit={setStartOffset} />
          </label>
        )}
      </div>

      <div className={style.fieldGroup}>
        <span className={style.groupTitle}>Ends</span>
        <Select
          aria-label='End trigger'
          options={endOptions}
          value={cue.end.trigger}
          onValueChange={(trigger) => trigger && setEndTrigger(trigger)}
          fluid
        />
        {cue.end.trigger !== 'duration' && (
          <Select
            aria-label='End event'
            options={eventOptions}
            value={cue.end.eventId}
            onValueChange={(eventId) => eventId && setEndReference(eventId)}
            fluid
          />
        )}
        {cue.end.trigger !== 'event-go' && (
          <label className={style.inlineField}>
            {cue.end.trigger === 'duration' ? 'Duration' : 'GO at'}
            <TimeField
              key={cue.end.trigger === 'duration' ? cue.end.duration : cue.end.offset}
              value={cue.end.trigger === 'duration' ? cue.end.duration : cue.end.offset}
              onSubmit={setEndTime}
            />
          </label>
        )}
      </div>

      {times && (
        <div className={style.summary}>
          {millisToString(times.start % 86_400_000)} → {millisToString(times.end % 86_400_000)}
        </div>
      )}

      <div className={style.inspectorActions}>
        <Button size='small' onClick={() => addLinked('auto-follow')}>
          <LuArrowRightFromLine /> Add auto-follow
        </Button>
        <Button size='small' onClick={() => addLinked('auto-continue')}>
          <LuLink2 /> Add auto-continue
        </Button>
        <Button size='small' variant='subtle-destructive' onClick={onDelete}>
          <IoTrash /> Delete cue
        </Button>
      </div>
    </div>
  );
}

function TextField({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const submit = () => {
    if (draft !== value) onSubmit(draft);
  };
  return (
    <Input
      fluid
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function TimeField({ value, onSubmit }: { value: number; onSubmit: (value: number) => void }) {
  const [draft, setDraft] = useState(millisToString(value));
  const submit = () => {
    const parsed = parseUserTime(draft);
    setDraft(millisToString(parsed));
    if (parsed !== value) onSubmit(parsed);
  };
  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit();
        if (event.key === 'Escape') setDraft(millisToString(value));
      }}
    />
  );
}
