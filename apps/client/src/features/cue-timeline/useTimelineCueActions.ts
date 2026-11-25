import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Rundown, RundownCues } from 'ontime-types';
import { useCallback } from 'react';

import { getRundownCacheKey } from '../../common/api/constants';
import { putTimelineCues } from '../../common/api/rundown';
import { logAxiosError } from '../../common/api/utils';
import { useRundownScope } from '../../common/context/RundownScopeContext';

/**
 * Replaces the timeline cues of the rundown in scope, optimistically
 */
export function useTimelineCueActions() {
  const queryClient = useQueryClient();
  const { rundownId } = useRundownScope();

  const { mutateAsync } = useMutation({
    mutationFn: ([targetId, cues]: [string, RundownCues]) => putTimelineCues(targetId, cues),
    onMutate: async ([targetId, cues]) => {
      const queryKey = getRundownCacheKey(targetId);
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<Rundown>(queryKey);
      if (previousData) {
        queryClient.setQueryData<Rundown>(queryKey, { ...previousData, cues, revision: -1 });
      }
      return { previousData, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData<Rundown>(context.queryKey, context.previousData);
      }
    },
    onSettled: (_data, _error, [targetId]) => queryClient.invalidateQueries({ queryKey: getRundownCacheKey(targetId) }),
  });

  const setCues = useCallback(
    async (cues: RundownCues) => {
      // the mutation keeps the rundown it was sent for, even if the scope changes meanwhile
      const targetId = queryClient.getQueryData<Rundown>(getRundownCacheKey(rundownId))?.id;
      if (!targetId) return;
      try {
        await mutateAsync([targetId, cues]);
      } catch (error) {
        logAxiosError('Error saving timeline cues', error);
      }
    },
    [mutateAsync, queryClient, rundownId],
  );

  return { setCues };
}
