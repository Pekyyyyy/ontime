import { MaybeString, ProjectRundown } from 'ontime-types';
import { memo, use, useMemo } from 'react';
import { LuChartGantt } from 'react-icons/lu';

import Button from '../../common/components/buttons/Button';
import Select from '../../common/components/select/Select';
import { PresetContext } from '../../common/context/PresetContext';
import { useRundownScope } from '../../common/context/RundownScopeContext';
import useCustomFields from '../../common/hooks-query/useCustomFields';
import { cx } from '../../common/utils/styleUtils';
import CueTimeline from '../../features/cue-timeline/CueTimeline';
import { useCueTimelinePanel } from '../../features/cue-timeline/useCueTimelinePanel';
import { AppMode } from '../../ontimeConfig';
import CuesheetDnd from './cuesheet-dnd/CuesheetDnd';
import { makeCuesheetColumns } from './cuesheet-table/cuesheet-table-elements/cuesheetColsFactory';
import CuesheetTable from './cuesheet-table/CuesheetTable';
import { useApplyCuesheetPolicy } from './useApplyCuesheetPolicy';
import { FOLLOW_LOADED_RUNDOWN_ID } from './useCuesheetRundownSelection';

import styles from './CuesheetPage.module.scss';

interface CuesheetTableWrapperProps {
  selectedRundownId: MaybeString;
  loadedRundownId: string;
  setSelectedRundownId: (rundownId: string) => void;
  projectRundowns: ProjectRundown[];
}

export default memo(CuesheetTableWrapper);
function CuesheetTableWrapper({
  selectedRundownId,
  setSelectedRundownId,
  loadedRundownId,
  projectRundowns,
}: CuesheetTableWrapperProps) {
  const preset = use(PresetContext);
  const { isLoaded } = useRundownScope();
  const { cuesheetMode, setCuesheetMode } = useApplyCuesheetPolicy(preset, { canRunMode: isLoaded });
  const { data: customFields } = useCustomFields();
  const timelinePanel = useCueTimelinePanel('cuesheet', 'horizontal');

  const columns = useMemo(
    () => makeCuesheetColumns(customFields, cuesheetMode, preset),
    [customFields, cuesheetMode, preset],
  );

  return (
    <CuesheetDnd columns={columns}>
      <CuesheetTable
        columns={columns}
        cuesheetMode={cuesheetMode}
        tableRoot='cuesheet'
        setCuesheetMode={setCuesheetMode}
        insertElement={
          <>
            <Button
              variant={timelinePanel.isOpen ? 'primary' : 'subtle'}
              onClick={() => timelinePanel.setOpen(!timelinePanel.isOpen)}
              aria-pressed={timelinePanel.isOpen}
            >
              <LuChartGantt /> Cue timeline
            </Button>
            <RundownSelect
              cuesheetMode={cuesheetMode}
              selectedRundownId={selectedRundownId}
              loadedRundownId={loadedRundownId}
              setSelectedRundownId={setSelectedRundownId}
              projectRundowns={projectRundowns}
            />
          </>
        }
      />
      {timelinePanel.isOpen && (
        <div
          className={cx([styles.timelinePanel, timelinePanel.orientation === 'vertical' && styles.timelinePanelSide])}
          data-testid='cuesheet-timeline'
        >
          <CueTimeline
            orientation={timelinePanel.orientation}
            onOrientationChange={timelinePanel.setOrientation}
            readOnly={cuesheetMode === AppMode.Run}
          />
        </div>
      )}
    </CuesheetDnd>
  );
}

interface RundownSelectProps {
  cuesheetMode: AppMode;
  selectedRundownId: MaybeString;
  loadedRundownId: string;
  setSelectedRundownId: (rundownId: string) => void;
  projectRundowns: ProjectRundown[];
}

function RundownSelect({
  cuesheetMode,
  projectRundowns,
  loadedRundownId,
  selectedRundownId,
  setSelectedRundownId,
}: RundownSelectProps) {
  'use memo';
  const options = projectRundowns.map(({ id, title }) => ({
    value: id,
    label: loadedRundownId === id ? `${title} (loaded)` : title,
  }));
  options.unshift({
    value: FOLLOW_LOADED_RUNDOWN_ID,
    label: 'Follow loaded', // TODO: Better wording and maybe icon? and translation
  });

  return (
    <div className={styles.rundownSelect}>
      <Select
        value={selectedRundownId ?? undefined}
        options={options}
        onValueChange={(value) => {
          if (value) {
            setSelectedRundownId(value);
          }
        }}
        disabled={cuesheetMode === AppMode.Run}
        fluid
      />
    </div>
  );
}
