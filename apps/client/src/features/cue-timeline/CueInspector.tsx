import type { EntryId, RundownCues, TimelineCue, TimelineCueId, TimelineCueStartTrigger } from 'ontime-types';
import {
  anchorEndAt,
  anchorStartAt,
  dayInMs,
  isOneShotCue,
  makeEnd,
  makeStart,
  millisToString,
  parseUserTime,
  wouldCreateCycle,
} from 'ontime-utils';
import { useState } from 'react';
import { IoClose, IoTrash } from 'react-icons/io5';
import { LuArrowRightFromLine, LuLink2, LuLock } from 'react-icons/lu';

import Button from '../../common/components/buttons/Button';
import IconButton from '../../common/components/buttons/IconButton';
import Input from '../../common/components/input/input/Input';
import Select from '../../common/components/select/Select';
import { cx } from '../../common/utils/styleUtils';
import { TimelineModel, makeLinkedCue } from './cueTimeline.utils';

import style from './CueTimeline.module.scss';

const startOptions: { value: TimelineCueStartTrigger; label: string }[] = [
  { value: 'event-go', label: 'Event GO' },
  { value: 'inside-event', label: 'GO inside event' },
  { value: 'auto-follow', label: 'After cue (auto-follow)' },
  { value: 'auto-continue', label: 'With cue (auto-continue)' },
];

const goOptions = [
  { value: 'auto', label: 'GO by itself at its time' },
  { value: 'manual', label: 'Wait for a GO' },
];

const timingOptions = [
  { value: 'delay', label: 'Planned time + delay' },
  { value: 'fixed', label: 'Planned time' },
];

const nextEventOptions = [
  { value: 'none', label: 'Starts by itself' },
  { value: 'auto-follow', label: 'Follows this cue (auto-follow)' },
  { value: 'auto-continue', label: 'Starts with this cue (auto-continue)' },
];

/** a time of the timeline, shown as a time of day */
const toTimeOfDay = (time: number) => millisToString(((time % dayInMs) + dayInMs) % dayInMs);

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
    // a one-shot has nothing to run along with, only auto-follow can start from it
    .filter((candidate) => cue.start.trigger !== 'auto-continue' || !isOneShotCue(candidate))
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

  /** a time typed as a time of day, on the day of the cue */
  const fromTimeOfDay = (value: number, around: number) => {
    const day = Math.floor(around / dayInMs) * dayInMs;
    return day + value;
  };

  const setStartTime = (value: number) => {
    if (!times) return;
    const time = fromTimeOfDay(value, times.start);
    update({ start: anchorStartAt(cue.start, time, { ...options, snap: 0 }) });
  };

  const setPredelay = (predelay: number) => {
    if (cue.start.trigger === 'event-go') {
      if (predelay > 0) update({ start: { trigger: 'inside-event', eventId: cue.start.eventId, offset: predelay } });
      return;
    }
    setStartOffset(predelay);
  };

  /** the length and the end time lock each other, the cue keeps the one which was set last */
  const setEndMode = (endMode: 'length' | 'end') => {
    if (!times) return;
    const end =
      endMode === 'length'
        ? makeEnd('duration', times.end, times.start, {}, options)
        : anchorEndAt({ trigger: 'inside-event', eventId: '', offset: 0 }, times.end, times.start, options);
    if (end) update({ end });
  };

  const setLength = (duration: number) => update({ end: { trigger: 'duration', duration } });

  const setEndClock = (value: number) => {
    if (!times) return;
    const time = fromTimeOfDay(value, times.start);
    const end = anchorEndAt(
      { trigger: 'inside-event', eventId: '', offset: 0 },
      time < times.start ? time + dayInMs : time,
      times.start,
      options,
    );
    update({ end });
  };

  /** a cue which moves the show on waits for Next, which becomes its GO */
  const setNextEvent = (value: string) => {
    if (value === 'auto-follow' || value === 'auto-continue') {
      // the event whose GO comes next after the cue: the cue is drawn against it
      const go = times ? (value === 'auto-follow' ? times.end : times.start) : 0;
      const eventId = cue.nextEvent?.eventId ?? model.spans.find((span) => span.start >= go - 1)?.id;
      const length = times ? times.end - times.start : 0;
      update({
        nextEvent: { trigger: value, offset: cue.nextEvent?.offset ?? 0, ...(eventId && { eventId }) },
        // the length of the cue holds, its place follows the event
        end: { trigger: 'duration', duration: Math.max(0, Math.round(length)) },
        goMode: 'manual',
      });
    } else {
      update({ nextEvent: null });
    }
  };

  const setOneShot = (isOneShot: boolean) => {
    if (isOneShot) {
      update({ end: { trigger: 'duration', duration: 0 } });
    } else {
      update({ end: { trigger: 'duration', duration: 10_000 } });
    }
  };

  const setEndReference = (eventId: EntryId) => {
    if (!times || cue.end.trigger === 'duration') return;
    const end = makeEnd(cue.end.trigger, times.end, times.start, { eventId }, options);
    if (!end) return;
    if ('offset' in end && 'offset' in cue.end) end.offset = cue.end.offset;
    update({ end });
  };

  const addLinked = (trigger: 'auto-follow' | 'auto-continue') => {
    const linked = makeLinkedCue(cue, trigger, model.resolved);
    onChange({ ...cues, [linked.id]: linked }, linked.id);
  };

  const startReference = 'eventId' in cue.start ? cue.start.eventId : cue.start.cueId;
  const isCueStart = cue.start.trigger === 'auto-follow' || cue.start.trigger === 'auto-continue';
  const isOneShot = isOneShotCue(cue);
  const endMode = cue.end.trigger === 'duration' ? 'length' : 'end';
  const predelay = 'offset' in cue.start ? cue.start.offset : 0;
  const reference = isCueStart && 'cueId' in cue.start ? cues[cue.start.cueId] : undefined;

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
        <label className={style.inlineField}>
          Predelay
          <TimeField key={predelay} value={predelay} onSubmit={setPredelay} />
        </label>
        {times && (
          <label className={style.inlineField}>
            Start time
            <TimeField key={times.start} value={times.start} format={toTimeOfDay} onSubmit={setStartTime} />
          </label>
        )}
        {reference && isOneShotCue(reference) && cue.start.trigger === 'auto-follow' && (
          <span className={style.summary}>Follows a one-shot, straight after its GO plus the predelay</span>
        )}
      </div>

      <div className={style.fieldGroup}>
        <span className={style.groupTitle}>GO</span>
        {isCueStart ? (
          <span className={style.summary}>Goes with {reference?.label || 'its cue'}, after the predelay</span>
        ) : (
          <>
            <Select
              aria-label='GO mode'
              options={goOptions}
              value={cue.goMode}
              onValueChange={(goMode) => goMode && update({ goMode: goMode as TimelineCue['goMode'] })}
              fluid
            />
            <Select
              aria-label='Timing'
              options={timingOptions}
              value={cue.followsDelay ? 'delay' : 'fixed'}
              onValueChange={(timing) => timing && update({ followsDelay: timing === 'delay' })}
              fluid
            />
          </>
        )}
      </div>

      <div className={style.fieldGroup}>
        <span className={style.groupTitle}>Ends</span>
        <label className={style.checkField}>
          <input type='checkbox' checked={isOneShot} onChange={(event) => setOneShot(event.target.checked)} />
          One-shot, a single GO with nothing to stop
        </label>
        {!isOneShot && times && (
          <>
            <div className={style.inlineField}>
              <button
                type='button'
                className={cx([style.lockToggle, endMode !== 'length' && style.locked])}
                onClick={() => setEndMode('length')}
                aria-label='Keep the length'
              >
                {endMode !== 'length' && <LuLock />} Length
              </button>
              <TimeField
                key={`length-${times.end - times.start}`}
                value={times.end - times.start}
                onSubmit={setLength}
                disabled={endMode !== 'length'}
              />
            </div>
            <div className={style.inlineField}>
              <button
                type='button'
                className={cx([style.lockToggle, endMode !== 'end' && style.locked])}
                onClick={() => setEndMode('end')}
                aria-label='Keep the end time'
              >
                {endMode !== 'end' && <LuLock />} End time
              </button>
              <TimeField
                key={`end-${times.end}`}
                value={times.end}
                format={toTimeOfDay}
                onSubmit={setEndClock}
                disabled={endMode !== 'end'}
              />
            </div>
            {cue.end.trigger !== 'duration' && (
              <Select
                aria-label='End event'
                options={eventOptions}
                value={cue.end.eventId}
                onValueChange={(eventId) => eventId && setEndReference(eventId)}
                fluid
              />
            )}
          </>
        )}
      </div>

      <div className={style.fieldGroup}>
        <span className={style.groupTitle}>Next event</span>
        <Select
          aria-label='Next event'
          options={nextEventOptions}
          value={cue.nextEvent?.trigger ?? 'none'}
          onValueChange={(value) => value && setNextEvent(value)}
          fluid
        />
        {cue.nextEvent && (
          <>
            <Select
              aria-label='Event it starts'
              options={eventOptions}
              value={cue.nextEvent.eventId ?? ''}
              onValueChange={(eventId) =>
                eventId && cue.nextEvent && update({ nextEvent: { ...cue.nextEvent, eventId } })
              }
              fluid
            />
            <label className={style.inlineField}>
              Wait
              <TimeField
                key={cue.nextEvent.offset}
                value={cue.nextEvent.offset}
                onSubmit={(offset) => cue.nextEvent && update({ nextEvent: { ...cue.nextEvent, offset } })}
              />
            </label>
            <span className={style.summary}>
              Next is the GO of this cue, the event starts{' '}
              {cue.nextEvent.trigger === 'auto-follow' ? 'when the cue ends' : 'with the cue'}, after the wait. The cue
              stays lined up with the GO of the event
            </span>
          </>
        )}
      </div>

      <div className={style.inspectorActions}>
        <Button size='small' onClick={() => addLinked('auto-follow')}>
          <LuArrowRightFromLine /> Add auto-follow
        </Button>
        <Button
          size='small'
          onClick={() => addLinked('auto-continue')}
          disabled={isOneShot}
          title={isOneShot ? 'A one-shot has nothing to run along with, use auto-follow' : undefined}
        >
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

function TimeField({
  value,
  onSubmit,
  format = millisToString,
  disabled,
}: {
  value: number;
  onSubmit: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(format(value));
  const submit = () => {
    if (draft === format(value)) return;
    const parsed = parseUserTime(draft);
    setDraft(millisToString(parsed));
    onSubmit(parsed);
  };
  return (
    <Input
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit();
        if (event.key === 'Escape') setDraft(format(value));
      }}
    />
  );
}
