import {useMemo, useState} from 'react';

import {useTimelineStore} from '../timeline/useTimelineStore';

export function useObservationLab() {
  const timeline = useTimelineStore();
  const worklogTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    [],
  );
  const [selectedWorklogDateIso, setSelectedWorklogDateIso] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [selectedWorklogBlockId, setSelectedWorklogBlockId] =
    useState<string | null>(null);

  return {
    ...timeline,
    selectedWorklogDateIso,
    setSelectedWorklogDateIso,
    selectedWorklogBlockId,
    setSelectedWorklogBlockId,
    worklogTimezone,
  };
}
