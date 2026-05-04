import { useCallback, useEffect, useState } from 'react';

import type { FlowElectronApi } from '../../shared/flowApi';
import type { PermissionsStatus } from '../../../src/types/contextCapture';

export function useAppStatus(flow: FlowElectronApi | undefined) {
  const [version, setVersion] = useState<string>('loading');
  const [permissionStatus, setPermissionStatus] = useState<string>('loading');
  const [permissions, setPermissions] = useState<PermissionsStatus | null>(
    null,
  );

  const checkPermissions = useCallback(() => {
    flow?.capture
      .getPermissionsStatus()
      .then(payload => {
        setPermissions(payload);
        setPermissionStatus(
          `accessibility=${
            payload.accessibilityTrusted ? 'granted' : 'missing'
          }, screen=${payload.captureAccessGranted ? 'granted' : 'missing'}`,
        );
      })
      .catch(() => {
        setPermissions(null);
        setPermissionStatus('unavailable');
      });
  }, [flow]);

  useEffect(() => {
    if (flow == null) {
      setVersion('preview');
    } else {
      Promise.all([flow.app.getVersion(), flow.app.getProfile()])
        .then(([appVersion, profile]) => {
          setVersion(profile === 'dev' ? `${appVersion} dev` : appVersion);
        })
        .catch(() => setVersion('unavailable'));
    }
    checkPermissions();
    window.addEventListener('focus', checkPermissions);
    return () => window.removeEventListener('focus', checkPermissions);
  }, [checkPermissions, flow]);

  return {
    version,
    permissions,
    permissionStatus,
    checkPermissions,
  };
}
