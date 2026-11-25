import { OntimeEvent, RundownCues, TimelineCue, TimelineCueId, isOntimeEvent } from 'ontime-types';
import { getTimelineEventSpans, isOneShotCue, millisToString } from 'ontime-utils';
import {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  UIEvent,
  WheelEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { IoAdd, IoRemove } from 'react-icons/io5';
import { LuArrowDownUp, LuArrowLeftRight, LuLink2, LuOctagonX, LuRotateCcw, LuSkipForward } from 'react-icons/lu';

import Button from '../../common/components/buttons/Button';
import IconButton from '../../common/components/buttons/IconButton';
import { useEntryActionsContext } from '../../common/context/EntryActionsContext';
import { useRundownScope } from '../../common/context/RundownScopeContext';
import useCustomFields from '../../common/hooks-query/useCustomFields';
import useRundown from '../../common/hooks-query/useRundown';
import { setCuePlayback } from '../../common/hooks/useSocket';
import { cx } from '../../common/utils/styleUtils';
import { AppMode } from '../../ontimeConfig';
import { useEventSelection } from '../rundown/useEventSelection';
import CueInspector from './CueInspector';
import {
  CueDragKind,
  EventDragKind,
  TimelineModel,
  TimelineOrientation,
  dragCue,
  dragEvent,
  getCueColour,
  getRulerStep,
  makeCueAt,
  makeCueBetween,
  makeTimelineModelFromSpans,
  removeCue,
  snapToGrid,
} from './cueTimeline.utils';
import { useCueLive } from './useCueLive';
import { useTimelineCueActions } from './useTimelineCueActions';

import style from './CueTimeline.module.scss';

/** size of the lane labels, before the time axis starts */
const labelSize = { horizontal: 120, vertical: 32 };
/** size of the ruler, before the lanes start */
const rulerSize = { horizontal: 24, vertical: 56 };
/** size of the events lane */
const eventLaneSize = { horizontal: 44, vertical: 110 };
/** size of a row of cues */
const rowSize = { horizontal: 30, vertical: 84 };
/** how far, in pixels, a time snaps to an event GO */
const goSnapPx = 8;
/** a one-shot cue has no length, it shows long enough to read its name */
const oneShotSize = 96;
const minZoom = 0.5;
const maxZoom = 200;

type DragState =
  | {
      target: 'cue';
      id: TimelineCueId;
      kind: CueDragKind;
      originMain: number;
      delta: number;
      track: string;
      moved: boolean;
      noSnap: boolean;
    }
  | {
      target: 'event';
      id: string;
      kind: EventDragKind;
      originMain: number;
      delta: number;
      moved: boolean;
      noSnap: boolean;
    }
  | {
      target: 'create';
      track: string;
      originMain: number;
      delta: number;
      moved: boolean;
      noSnap: boolean;
    };

interface CueTimelineProps {
  orientation: TimelineOrientation;
  onOrientationChange?: (orientation: TimelineOrientation) => void;
  /** edit mode edits and tests cues, run mode plays them */
  mode: AppMode;
  className?: string;
}

export default function CueTimeline({ orientation, onOrientationChange, mode, className }: CueTimelineProps) {
  const isRunMode = mode === AppMode.Run;
  const readOnly = isRunMode;
  const { data: rundown } = useRundown();
  const { isLoaded } = useRundownScope();
  const live = useCueLive(rundown, isLoaded);
  const { data: customFields } = useCustomFields();
  const { updateEntry } = useEntryActionsContext();
  const { setCues } = useTimelineCueActions();
  const setSingleEntrySelection = useEventSelection((state) => state.setSingleEntrySelection);

  /** pixels per minute */
  const [zoom, setZoom] = useState(orientation === 'horizontal' ? 8 : 4);
  const [selectedCueId, setSelectedCueId] = useState<TimelineCueId | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const pxPerMs = zoom / 60_000;
  const isHorizontal = orientation === 'horizontal';
  const mainOffset = labelSize[orientation];
  const crossOffset = rulerSize[orientation];
  const eventLane = eventLaneSize[orientation];
  const row = rowSize[orientation];
  const snapMs = goSnapPx / pxPerMs;
  const grid = getRulerStep(pxPerMs, 10);

  const cues = useMemo<RundownCues>(() => rundown.cues ?? {}, [rundown.cues]);
  const events = useMemo(() => {
    const map: Record<string, OntimeEvent> = {};
    for (const id of rundown.flatOrder) {
      const entry = rundown.entries[id];
      if (entry && isOntimeEvent(entry)) map[id] = entry;
    }
    return map;
  }, [rundown.flatOrder, rundown.entries]);

  const baseModel = useMemo(
    () => makeTimelineModelFromSpans(getTimelineEventSpans(rundown), cues, customFields),
    [rundown, cues, customFields],
  );

  // while dragging, the model is drawn with the dragged change applied
  const preview = useMemo(() => {
    if (!drag || !drag.moved) return null;
    const delta = drag.noSnap ? drag.delta : snapToGrid(drag.delta, grid);
    if (drag.target === 'cue') {
      const cue = cues[drag.id];
      if (!cue) return null;
      const next = dragCue(cue, drag.kind, delta, {
        spans: baseModel.spans,
        resolved: baseModel.resolved,
        snap: snapMs,
      });
      if (drag.kind === 'move') next.track = drag.track;
      const previewCues = { ...cues, [cue.id]: next };
      return { cue: next, model: makeTimelineModelFromSpans(baseModel.spans, previewCues, customFields) };
    }
    if (drag.target === 'create') {
      const from = baseModel.rangeStart + (drag.originMain - mainOffset) / pxPerMs;
      const to = from + delta;
      const cue = makeCueBetween(drag.track, Math.min(from, to), Math.max(from, to), baseModel.spans, snapMs);
      if (!cue) return null;
      const previewCues = { ...cues, [cue.id]: cue };
      return { cue, model: makeTimelineModelFromSpans(baseModel.spans, previewCues, customFields) };
    }
    const event = events[drag.id];
    if (!event) return null;
    const patch = dragEvent(event, drag.kind, delta);
    const spans = baseModel.spans.map((span) => {
      if (span.id !== drag.id) return span;
      const start = span.start + ((patch.timeStart ?? event.timeStart) - event.timeStart);
      return { ...span, start, end: start + (patch.duration ?? event.duration) };
    });
    return { patch, model: makeTimelineModelFromSpans(spans, cues, customFields) };
  }, [drag, cues, events, baseModel, customFields, grid, snapMs, mainOffset, pxPerMs]);

  const model: TimelineModel = preview?.model ?? baseModel;
  // the range only changes when a drag ends, so the canvas does not move under the pointer
  const rangeStart = baseModel.rangeStart;
  const rangeEnd = Math.max(baseModel.rangeEnd, model.rangeEnd);

  const mainLength = mainOffset + (rangeEnd - rangeStart) * pxPerMs;
  const crossLength = crossOffset + eventLane + Math.max(1, model.totalRows) * row;

  const toMain = (time: number) => mainOffset + (time - rangeStart) * pxPerMs;

  /** places an element on the canvas from its position along the time axis and across the lanes */
  const place = (main: number, mainSize: number, cross: number, crossSize: number): CSSProperties =>
    isHorizontal
      ? { left: main, width: mainSize, top: cross, height: crossSize }
      : { top: main, height: mainSize, left: cross, width: crossSize };

  const getPointer = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { main: 0, cross: 0 };
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return isHorizontal ? { main: x, cross: y } : { main: y, cross: x };
    },
    [isHorizontal],
  );

  const getTrackAt = (cross: number) => {
    const rowIndex = Math.floor((cross - crossOffset - eventLane) / row);
    return baseModel.tracks.find((track) => rowIndex >= track.firstRow && rowIndex < track.firstRow + track.rowCount);
  };

  // #region pointer handling
  const startCueDrag = (event: PointerEvent<HTMLElement>, cue: TimelineCue, kind: CueDragKind) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (readOnly) {
      setSelectedCueId(cue.id);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      target: 'cue',
      id: cue.id,
      kind,
      originMain: getPointer(event).main,
      delta: 0,
      track: cue.track,
      moved: false,
      noSnap: event.shiftKey,
    });
  };

  const startEventDrag = (event: PointerEvent<HTMLElement>, id: string, kind: EventDragKind) => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      target: 'event',
      id,
      kind,
      originMain: getPointer(event).main,
      delta: 0,
      moved: false,
      noSnap: event.shiftKey,
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const pointer = getPointer(event);
    const distance = pointer.main - drag.originMain;
    const moved = drag.moved || Math.abs(distance) > 3;
    const delta = distance / pxPerMs;
    if (drag.target === 'create') {
      setDrag({ ...drag, delta, moved, noSnap: event.shiftKey });
    } else if (drag.target === 'cue') {
      const track = drag.kind === 'move' ? (getTrackAt(pointer.cross)?.key ?? drag.track) : drag.track;
      setDrag({ ...drag, delta, moved: moved || track !== drag.track, track, noSnap: event.shiftKey });
    } else {
      setDrag({ ...drag, delta, moved, noSnap: event.shiftKey });
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const current = drag;
    setDrag(null);

    if (!current.moved) {
      if (current.target === 'cue') setSelectedCueId(current.id);
      return;
    }

    if (current.target === 'create' && preview?.cue) {
      void setCues({ ...cues, [preview.cue.id]: preview.cue });
      setSelectedCueId(preview.cue.id);
    } else if (current.target === 'cue' && preview?.cue) {
      void setCues({ ...cues, [preview.cue.id]: preview.cue });
    } else if (current.target === 'event' && preview?.patch) {
      void updateEntry(preview.patch);
    }
  };
  /** in edit mode, dragging over an empty part of a lane draws a new cue */
  const startCreateDrag = (event: PointerEvent<HTMLDivElement>) => {
    const isBackground = event.target === event.currentTarget || (event.target as HTMLElement).dataset.lane;
    if (!isBackground) return;
    setSelectedCueId(null);
    if (event.button !== 0 || readOnly) return;
    const pointer = getPointer(event);
    const track = getTrackAt(pointer.cross);
    if (!track || pointer.main < mainOffset) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      target: 'create',
      track: track.key,
      originMain: pointer.main,
      delta: 0,
      moved: false,
      noSnap: event.shiftKey,
    });
  };
  // #endregion pointer handling

  const handleCanvasDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const pointer = getPointer(event);
    const track = getTrackAt(pointer.cross);
    if (!track) return;
    const time = rangeStart + (pointer.main - mainOffset) / pxPerMs;
    const cue = makeCueAt(track.key, snapToGrid(time, grid), baseModel.spans, snapMs);
    if (!cue) return;
    void setCues({ ...cues, [cue.id]: cue });
    setSelectedCueId(cue.id);
  };

  const deleteCue = useCallback(
    (cueId: TimelineCueId) => {
      void setCues(removeCue(cues, cueId, baseModel.spans, baseModel.resolved));
      setSelectedCueId(null);
    },
    [cues, baseModel, setCues],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Escape') setSelectedCueId(null);
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCueId && !readOnly) {
      event.preventDefault();
      deleteCue(selectedCueId);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom((current) => clampZoom(current * (event.deltaY > 0 ? 0.9 : 1.1)));
  };

  // keep the ruler and the lane labels in view while scrolling
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollTop } = event.currentTarget;
    if (rulerRef.current) {
      rulerRef.current.style.transform = isHorizontal ? `translateY(${scrollTop}px)` : `translateX(${scrollLeft}px)`;
    }
    if (labelsRef.current) {
      labelsRef.current.style.transform = isHorizontal ? `translateX(${scrollLeft}px)` : `translateY(${scrollTop}px)`;
    }
  };

  // #region drawing
  const rulerStep = getRulerStep(pxPerMs, isHorizontal ? 70 : 40);
  const marks: number[] = [];
  for (let time = Math.ceil(rangeStart / rulerStep) * rulerStep; time <= rangeEnd; time += rulerStep) {
    marks.push(time);
  }

  const trackColours = Object.fromEntries(model.tracks.map((track) => [track.key, track.colour]));
  const eventLabels = Object.fromEntries(
    Object.values(events).map((event) => [event.id, event.cue ? `${event.cue} ${event.title}` : event.title]),
  );

  const displayedCues: RundownCues = preview?.cue ? { ...cues, [preview.cue.id]: preview.cue } : cues;

  const getCueBox = (cueId: TimelineCueId) => {
    const cue = displayedCues[cueId];
    const times = model.resolved[cueId];
    const track = model.tracks.find((candidate) => candidate.key === cue?.track);
    if (!cue || !times || !track) return null;
    const rowIndex = track.firstRow + (model.layout.rows[cueId] ?? 0);
    const main = toMain(times.start);
    const isOneShot = isOneShotCue(cue);
    const mainSize = isOneShot ? oneShotSize : Math.max(6, (times.end - times.start) * pxPerMs);
    const cross = crossOffset + eventLane + rowIndex * row;
    return { cue, main, mainSize, cross, isOneShot };
  };

  // cues which start an event are drawn with their wait up to its GO
  const eventLinks: { key: string; from: number; to: number; cross: number }[] = [];
  for (const cueId in displayedCues) {
    const nextEvent = displayedCues[cueId].nextEvent;
    const span = nextEvent?.eventId ? model.spans.find((candidate) => candidate.id === nextEvent.eventId) : undefined;
    const box = span ? getCueBox(cueId) : null;
    if (!nextEvent || !span || !box) continue;
    const isFromEnd = nextEvent.trigger === 'auto-follow' && !box.isOneShot;
    const from = isFromEnd ? box.main + box.mainSize : box.main;
    eventLinks.push({ key: cueId, from, to: toMain(span.start), cross: box.cross + row / 2 });
  }

  const links: { key: string; path: string; kind: 'follow' | 'continue' }[] = [];
  for (const cueId in displayedCues) {
    const displayed = displayedCues[cueId];
    if (displayed.start.trigger !== 'auto-follow' && displayed.start.trigger !== 'auto-continue') continue;
    const box = getCueBox(cueId);
    const reference = getCueBox(displayed.start.cueId);
    if (!box || !reference) continue;
    const childCross = box.cross + row / 2;
    const referenceCross = reference.cross + row / 2;
    if (displayed.start.trigger === 'auto-follow') {
      // a one-shot has no end, its follow starts from its GO
      const from = reference.isOneShot ? reference.main : reference.main + reference.mainSize;
      const to = box.main;
      if (childCross === referenceCross) {
        // cues in the same row are joined by an arc over their edge, so that touching cues still show the link
        const edge = box.cross + 2;
        links.push({
          key: cueId,
          kind: 'follow',
          path: makePath(isHorizontal, [
            ['M', from - 8, edge],
            ['C', from - 4, edge - 10],
            ['', to + 4, edge - 10],
            ['', to + 8, edge],
          ]),
        });
      } else {
        const bend = Math.max(12, Math.abs(to - from) / 2);
        links.push({
          key: cueId,
          kind: 'follow',
          path: makePath(isHorizontal, [
            ['M', from, referenceCross],
            ['C', from + bend, referenceCross],
            ['', to - bend, childCross],
            ['', to, childCross],
          ]),
        });
      }
    } else {
      const bracket = box.main - 5;
      links.push({
        key: cueId,
        kind: 'continue',
        path: makePath(isHorizontal, [
          ['M', reference.main, referenceCross],
          ['L', bracket, referenceCross],
          ['L', bracket, childCross],
          ['L', box.main, childCross],
        ]),
      });
    }
  }
  // #endregion drawing

  const selectedCue = selectedCueId ? cues[selectedCueId] : undefined;
  const hasTracks = model.tracks.length > 0;

  return (
    <div className={cx([style.cueTimeline, style[orientation], className])} data-testid='cue-timeline'>
      <div className={style.toolbar}>
        <span className={style.toolbarTitle}>Cue timeline</span>
        <IconButton
          aria-label='Zoom out'
          size='small'
          variant='subtle-white'
          onClick={() => setZoom((z) => clampZoom(z / 1.5))}
        >
          <IoRemove />
        </IconButton>
        <IconButton
          aria-label='Zoom in'
          size='small'
          variant='subtle-white'
          onClick={() => setZoom((z) => clampZoom(z * 1.5))}
        >
          <IoAdd />
        </IconButton>
        {onOrientationChange && (
          <IconButton
            aria-label={isHorizontal ? 'Show time top to bottom' : 'Show time left to right'}
            size='small'
            variant='subtle-white'
            onClick={() => onOrientationChange(isHorizontal ? 'vertical' : 'horizontal')}
          >
            {isHorizontal ? <LuArrowDownUp /> : <LuArrowLeftRight />}
          </IconButton>
        )}
        {isRunMode && isLoaded && (
          <>
            <Button size='small' variant='primary' onClick={setCuePlayback.next} data-testid='cue-go-next'>
              GO next cue
            </Button>
            <Button size='small' onClick={setCuePlayback.rearmAll}>
              <LuRotateCcw /> Rearm all
            </Button>
          </>
        )}
        {isLoaded && (
          <Button
            size='small'
            variant='destructive'
            className={style.panic}
            onClick={setCuePlayback.panic}
            data-testid='cue-panic'
          >
            <LuOctagonX /> Panic
          </Button>
        )}
        <span className={style.hint}>
          {isRunMode
            ? 'GO plays a cue and its chain · a played cue needs a rearm · Next plays the cues of the running event before the next event'
            : 'Drag on a lane to draw a cue · drag to move · drag edges to resize · Shift to skip snapping · Test plays a cue alone'}
        </span>
      </div>
      <div className={style.body}>
        <div
          className={style.scroller}
          onScroll={handleScroll}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          {!hasTracks ? (
            <div className={style.empty}>
              Add a text custom field in the project settings to get a cue lane, eg: Camera or QLab.
            </div>
          ) : (
            <div
              ref={canvasRef}
              className={style.canvas}
              style={
                isHorizontal ? { width: mainLength, height: crossLength } : { height: mainLength, width: crossLength }
              }
              onDoubleClick={handleCanvasDoubleClick}
              onPointerDown={startCreateDrag}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {/* lane backgrounds */}
              {model.tracks.map((track) => (
                <div
                  key={track.key}
                  data-lane={track.key}
                  className={style.lane}
                  style={place(
                    mainOffset,
                    mainLength - mainOffset,
                    crossOffset + eventLane + track.firstRow * row,
                    track.rowCount * row,
                  )}
                />
              ))}

              {/* event GO lines across the lanes */}
              {model.spans.map((span) => (
                <div
                  key={`go-${span.id}`}
                  className={style.goLine}
                  style={place(toMain(span.start), 1, crossOffset, crossLength - crossOffset)}
                />
              ))}

              {/* events lane */}
              {model.spans.map((span) => {
                const event = events[span.id];
                if (!event) return null;
                const isDragged = drag?.target === 'event' && drag.id === span.id;
                return (
                  <div
                    key={span.id}
                    className={cx([style.event, isDragged && style.dragging, event.skip && style.skipped])}
                    style={
                      {
                        ...place(
                          toMain(span.start),
                          Math.max(4, (span.end - span.start) * pxPerMs),
                          crossOffset + 2,
                          eventLane - 4,
                        ),
                        '--event-colour': event.colour || undefined,
                      } as CSSProperties
                    }
                    title={`${eventLabels[span.id]}\n${millisToString(event.timeStart)} - ${millisToString(event.timeEnd)}`}
                    onPointerDown={(e) => startEventDrag(e, span.id, 'move')}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSingleEntrySelection({ id: span.id });
                    }}
                  >
                    <span className={style.eventLabel}>
                      {event.cue && <strong>{event.cue}</strong>} {event.title}
                    </span>
                    <span
                      className={cx([style.handle, style.handleStart])}
                      onPointerDown={(e) => startEventDrag(e, span.id, 'start')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    />
                    <span
                      className={cx([style.handle, style.handleEnd])}
                      onPointerDown={(e) => startEventDrag(e, span.id, 'end')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    />
                  </div>
                );
              })}

              {/* links between cues */}
              <svg
                className={style.links}
                width={isHorizontal ? mainLength : crossLength}
                height={isHorizontal ? crossLength : mainLength}
                aria-hidden
              >
                {links.map((link) => (
                  <path
                    key={link.key}
                    d={link.path}
                    className={link.kind === 'follow' ? style.followLink : style.continueLink}
                  />
                ))}
              </svg>

              {/* cues */}
              {Object.keys(displayedCues).map((cueId) => {
                const box = getCueBox(cueId);
                if (!box) return null;
                const { cue, isOneShot } = box;
                const isSelected = cueId === selectedCueId;
                const isDragged = (drag?.target === 'cue' && drag.id === cueId) || !cues[cueId];
                const entry = live.entries[cueId];
                const hasPlayed = entry !== undefined && entry.status !== 'test';
                return (
                  <div
                    key={cueId}
                    className={cx([
                      style.cue,
                      isSelected && style.selected,
                      isDragged && style.dragging,
                      isOneShot && style.oneShot,
                      (entry?.status === 'running' || entry?.status === 'test') && style.running,
                      (entry?.status === 'done' || entry?.status === 'stopped') && style.done,
                      entry?.status === 'stopped' && style.stopped,
                      cueId === live.nextCueId && style.nextCue,
                    ])}
                    style={
                      {
                        ...place(box.main, box.mainSize, box.cross + 2, row - 4),
                        '--cue-colour': getCueColour(cue, trackColours[cue.track]),
                      } as CSSProperties
                    }
                    title={cue.note || cue.label}
                    onPointerDown={(e) => startCueDrag(e, cue, 'move')}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onDoubleClick={(e) => e.stopPropagation()}
                    data-testid='timeline-cue'
                  >
                    {cue.start.trigger === 'auto-continue' && <LuLink2 className={style.linkIcon} />}
                    {cues[cueId] && (isRunMode ? isLoaded : box.mainSize >= 64 || isSelected) && (
                      <button
                        type='button'
                        className={cx([style.cueAction, isRunMode && !hasPlayed && style.cueGo])}
                        onPointerDown={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isRunMode) setCuePlayback.test(cueId);
                          else if (hasPlayed) setCuePlayback.rearm(cueId);
                          else setCuePlayback.go(cueId);
                        }}
                        data-testid='cue-action'
                      >
                        {!isRunMode ? 'Test' : hasPlayed ? 'Rearm' : 'GO'}
                      </button>
                    )}
                    <span className={style.cueLabel}>{cue.label}</span>
                    {cue.nextEvent && (
                      <LuSkipForward
                        className={style.nextEventIcon}
                        aria-label={
                          cue.nextEvent.trigger === 'auto-follow' ? 'Next event follows' : 'Next event continues'
                        }
                      />
                    )}
                    {!readOnly && (
                      <span
                        className={cx([style.handle, style.handleStart])}
                        onPointerDown={(e) => startCueDrag(e, cue, 'start')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      />
                    )}
                    {!readOnly && !isOneShot && (
                      <span
                        className={cx([style.handle, style.handleEnd])}
                        onPointerDown={(e) => startCueDrag(e, cue, 'end')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      />
                    )}
                  </div>
                );
              })}

              {/* the wait between a cue and the GO of the event it starts */}
              {eventLinks.map((link) => (
                <div
                  key={`event-link-${link.key}`}
                  className={style.eventLink}
                  style={place(
                    Math.min(link.from, link.to),
                    Math.max(2, Math.abs(link.to - link.from)),
                    link.cross - 1,
                    2,
                  )}
                />
              ))}

              {/* where the show is on the plan */}
              {live.planPosition !== null && (
                <div
                  className={style.playhead}
                  style={place(toMain(live.planPosition) - 1, 2, crossOffset, crossLength - crossOffset)}
                  data-testid='timeline-playhead'
                />
              )}

              {/* ruler, kept in view while scrolling */}
              <div
                ref={rulerRef}
                className={style.ruler}
                style={
                  isHorizontal
                    ? { left: 0, top: 0, width: mainLength, height: crossOffset }
                    : { left: 0, top: 0, height: mainLength, width: crossOffset }
                }
              >
                {/* the delay between the plan and the clock, and the clock itself */}
                {live.planPosition !== null && live.delay !== 0 && (
                  <div
                    className={cx([style.delayBand, live.delay < 0 && style.ahead])}
                    style={place(
                      toMain(Math.min(live.planPosition, live.now)),
                      Math.abs(live.delay) * pxPerMs,
                      0,
                      crossOffset,
                    )}
                    title={`${live.delay > 0 ? 'Behind' : 'Ahead'} ${millisToString(Math.abs(live.delay))}`}
                  />
                )}
                {isLoaded && <div className={style.realtime} style={place(toMain(live.now), 0, 0, crossOffset)} />}
                {marks.map((time) => (
                  <span
                    key={time}
                    className={style.mark}
                    style={isHorizontal ? { left: toMain(time) } : { top: toMain(time) }}
                  >
                    {formatMark(time, rulerStep)}
                  </span>
                ))}
              </div>

              {/* lane labels, kept in view while scrolling */}
              <div
                ref={labelsRef}
                className={style.labels}
                style={
                  isHorizontal
                    ? { left: 0, top: 0, width: mainOffset, height: crossLength }
                    : { left: 0, top: 0, width: crossLength, height: mainOffset }
                }
              >
                <div className={style.laneLabel} style={place(0, mainOffset, crossOffset, eventLane)}>
                  Events
                </div>
                {model.tracks.map((track) => (
                  <div
                    key={track.key}
                    className={style.laneLabel}
                    style={
                      {
                        ...place(0, mainOffset, crossOffset + eventLane + track.firstRow * row, track.rowCount * row),
                        '--lane-colour': track.colour,
                      } as CSSProperties
                    }
                  >
                    {track.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {selectedCue && !readOnly && cues[selectedCue.id] && (
          <CueInspector
            key={selectedCue.id}
            cue={selectedCue}
            cues={cues}
            model={baseModel}
            eventLabels={eventLabels}
            eventOrder={baseModel.spans.map((span) => span.id)}
            onChange={(next: RundownCues, selectId?: TimelineCueId) => {
              void setCues(next);
              if (selectId) setSelectedCueId(selectId);
            }}
            onDelete={() => deleteCue(selectedCue.id)}
            onClose={() => setSelectedCueId(null)}
          />
        )}
      </div>
    </div>
  );
}

function clampZoom(zoom: number) {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

function formatMark(time: number, step: number) {
  const text = millisToString(time % (24 * 60 * 60 * 1000));
  // drop the seconds when marks are a minute or more apart
  return step >= 60_000 ? text.slice(0, 5) : text;
}

/**
 * Builds an svg path from points given as time axis and lane axis coordinates
 */
function makePath(isHorizontal: boolean, points: [string, number, number][]) {
  return points
    .map(([command, main, cross]) => `${command}${isHorizontal ? `${main},${cross}` : `${cross},${main}`}`)
    .join(' ');
}
