import { useSessionStorage } from '@mantine/hooks';
import { memo } from 'react';

import * as Editor from '../../common/components/editor-utils/EditorUtils';
import ErrorBoundary from '../../common/components/error-boundary/ErrorBoundary';
import ViewNavigationMenu from '../../common/components/navigation-menu/ViewNavigationMenu';
import ProtectRoute from '../../common/components/protect-route/ProtectRoute';
import { useIsSmallDevice } from '../../common/hooks/useIsSmallDevice';
import { handleLinks } from '../../common/utils/linkUtils';
import { cx } from '../../common/utils/styleUtils';
import { getIsNavigationLocked } from '../../externals';
import { AppMode } from '../../ontimeConfig';
import EntryEditModal from '../../views/cuesheet/cuesheet-edit-modal/EntryEditModal';
import { EditorLayoutMode, useEditorLayout } from '../../views/editor/useEditorLayout';
import { useCueSelection } from '../cue-timeline/useCueSelection';
import RundownEntryEditor from './entry-editor/RundownEntryEditor';
import FinderPlacement from './placements/FinderPlacement';
import RenumberCuesDialog from './renumber-cues-dialog/RenumberCuesDialog';
import { RundownContextMenu } from './rundown-context-menu/RundownContextMenu';
import RundownHeader from './rundown-header/RundownHeader';
import RundownHeaderMobile from './rundown-header/RundownHeaderMobile';
import RundownTable from './rundown-table/RundownTable';
import { RundownViewMode } from './rundown.options';
import RundownCueView from './RundownCueView';
import RundownList from './RundownList';
import { useEditorFollowMode } from './useEditorFollowMode';

import style from './RundownExport.module.scss';

export default memo(RundownExport);

function RundownExport() {
  const isExtracted = window.location.pathname.includes('/rundown');
  const { editorMode } = useEditorFollowMode();
  const { layoutMode } = useEditorLayout();
  const [viewMode, setViewMode] = useSessionStorage<RundownViewMode>({
    key: 'rundown-view-mode',
    defaultValue: RundownViewMode.List,
  });
  const isSmallDevice = useIsSmallDevice();
  const hasSelectedCue = useCueSelection((state) => state.selectedCueId !== null);

  if (isSmallDevice && isExtracted) {
    return (
      <ProtectRoute permission='editor'>
        <div
          className={cx([style.rundownExport, style.extracted])}
          data-target='small-device'
          data-testid='panel-rundown'
        >
          <FinderPlacement />
          <ViewNavigationMenu suppressSettings />
          <div className={style.rundown}>
            <ErrorBoundary>
              <RundownRoot isSmallDevice isExtracted viewMode={viewMode} setViewMode={setViewMode} />
              <RundownContextMenu />
            </ErrorBoundary>
          </div>
        </div>
      </ProtectRoute>
    );
  }

  const hideSideBar =
    layoutMode === EditorLayoutMode.TRACKING ||
    (isExtracted && editorMode === AppMode.Run) ||
    // the table edits events in a modal, a selected cue still opens the side panel
    (viewMode === RundownViewMode.Table && !hasSelectedCue);

  return (
    <ProtectRoute permission='editor'>
      <div className={cx([style.rundownExport, isExtracted && style.extracted])} data-testid='panel-rundown'>
        <FinderPlacement />
        {isExtracted && <ViewNavigationMenu suppressSettings isNavigationLocked={getIsNavigationLocked()} />}
        <div className={style.rundown}>
          <Editor.Panel className={style.list}>
            <ErrorBoundary>
              {!isExtracted && <Editor.CornerExtract onClick={(event) => handleLinks('rundown', event)} />}
              <RundownRoot
                isExtracted={isExtracted}
                viewMode={viewMode}
                setViewMode={setViewMode}
                hasSidePanel={!hideSideBar}
              />
              <RundownContextMenu />
            </ErrorBoundary>
          </Editor.Panel>
          {!hideSideBar && (
            <div className={style.side}>
              <ErrorBoundary>
                <RundownEntryEditor />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>
    </ProtectRoute>
  );
}

interface RundownRootProps {
  isSmallDevice?: boolean;
  isExtracted?: boolean;
  viewMode: RundownViewMode;
  setViewMode: (mode: RundownViewMode) => void;
  hasSidePanel?: boolean;
}

function RundownRoot({ isSmallDevice, isExtracted, viewMode, setViewMode, hasSidePanel }: RundownRootProps) {
  return (
    <div className={style.rundownRoot}>
      {isSmallDevice ? (
        <RundownHeaderMobile viewMode={viewMode} setViewMode={setViewMode} />
      ) : (
        <RundownHeader isExtracted={isExtracted} viewMode={viewMode} setViewMode={setViewMode} />
      )}
      {viewMode === RundownViewMode.List && <RundownList />}
      {viewMode === RundownViewMode.Table && <RundownTable />}
      {viewMode === RundownViewMode.Cue && <RundownCueView hasSidePanel={hasSidePanel} />}
      {viewMode === RundownViewMode.Table && <EntryEditModal />}
      <RenumberCuesDialog />
    </div>
  );
}
