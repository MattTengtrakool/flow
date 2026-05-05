import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ApiKeyValidationResult,
  ApiProvider,
  FlowElectronApi,
  FlowSettings,
  FlowSettingsPatch,
} from '../../shared/flowApi';
import { DEFAULT_PROACTIVE_SETTINGS } from '../../../src/proactive/types';
import { DEFAULT_MEETING_ASSISTANT_SETTINGS } from '../../../src/meetings/types';

const missingKeyStatus = {
  configured: false,
  source: 'missing' as const,
  encrypted: false,
  lastValidatedAt: null,
  validationStatus: 'untested' as const,
  validationMessage: null,
};

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  onboardingCompleted: false,
  aiConnectionMode: 'managed',
  selectedProvider: 'gemini',
  privacyModeEnabled: false,
  managedAi: {
    configured: false,
    endpoint: null,
    authenticated: false,
  },
  proactive: DEFAULT_PROACTIVE_SETTINGS,
  meetingAssistant: DEFAULT_MEETING_ASSISTANT_SETTINGS,
  customCategories: [],
  apiKeys: {
    gemini: missingKeyStatus,
    anthropic: missingKeyStatus,
  },
};

export function useFlowSettings(flow: FlowElectronApi | undefined) {
  const [settings, setSettings] = useState<FlowSettings>(DEFAULT_FLOW_SETTINGS);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    flow == null ? 'error' : 'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<ApiKeyValidationResult | null>(null);

  const refresh = useCallback(async () => {
    if (flow == null) {
      setStatus('error');
      setErrorMessage('Electron bridge missing.');
      return DEFAULT_FLOW_SETTINGS;
    }
    try {
      const next = await flow.settings.getSettings();
      setSettings(next);
      setStatus('ready');
      setErrorMessage(null);
      return next;
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load settings.',
      );
      return DEFAULT_FLOW_SETTINGS;
    }
  }, [flow]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const updateSettings = useCallback(
    async (patch: FlowSettingsPatch) => {
      if (flow == null) return DEFAULT_FLOW_SETTINGS;
      const next = await flow.settings.updateSettings(patch);
      setSettings(next);
      return next;
    },
    [flow],
  );

  const setApiKey = useCallback(
    async (provider: ApiProvider, value: string) => {
      if (flow == null) return DEFAULT_FLOW_SETTINGS;
      const next = await flow.settings.setApiKey(provider, value);
      setSettings(next);
      setValidationResult(null);
      return next;
    },
    [flow],
  );

  const clearApiKey = useCallback(
    async (provider: ApiProvider) => {
      if (flow == null) return DEFAULT_FLOW_SETTINGS;
      const next = await flow.settings.clearApiKey(provider);
      setSettings(next);
      setValidationResult(null);
      return next;
    },
    [flow],
  );

  const validateApiKey = useCallback(
    async (provider: ApiProvider) => {
      if (flow == null) return null;
      const result = await flow.settings.validateApiKey(provider);
      setValidationResult(result);
      await refresh();
      return result;
    },
    [flow, refresh],
  );

  return useMemo(
    () => ({
      settings,
      status,
      errorMessage,
      validationResult,
      refresh,
      updateSettings,
      setApiKey,
      clearApiKey,
      validateApiKey,
    }),
    [
      clearApiKey,
      errorMessage,
      refresh,
      setApiKey,
      settings,
      status,
      updateSettings,
      validateApiKey,
      validationResult,
    ],
  );
}
