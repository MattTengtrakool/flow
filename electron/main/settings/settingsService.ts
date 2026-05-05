import { ipcMain, safeStorage } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { configureApiKeys } from '../../../src/config/apiKeys';
import {
  DEFAULT_PROACTIVE_SETTINGS,
  type ProactiveSettings,
} from '../../../src/proactive/types';
import {
  DEFAULT_MEETING_ASSISTANT_SETTINGS,
  type MeetingAssistantSettings,
} from '../../../src/meetings/types';
import type {
  ApiKeyStatus,
  ApiKeyValidationResult,
  AiConnectionMode,
  ApiProvider,
  FlowSettings,
  FlowSettingsPatch,
} from '../../shared/flowApi';
import type { WorkCategoryOption } from '../../../src/workCategories';
import { normalizeWorkCategoryOption } from '../../../src/workCategories';
import { getAppDataDirectoryPath } from '../appProfile';

type StoredApiKey = {
  value: string;
  encrypted: boolean;
};

type StoredSettings = {
  onboardingCompleted?: boolean;
  aiConnectionMode?: AiConnectionMode;
  selectedProvider?: ApiProvider;
  privacyModeEnabled?: boolean;
  proactive?: Partial<ProactiveSettings>;
  meetingAssistant?: Partial<MeetingAssistantSettings>;
  customCategories?: Array<Partial<WorkCategoryOption>>;
  apiKeys?: Partial<Record<ApiProvider, StoredApiKey>>;
  validation?: Partial<
    Record<
      ApiProvider,
      {
        lastValidatedAt: string | null;
        validationStatus: ApiKeyStatus['validationStatus'];
        validationMessage: string | null;
      }
    >
  >;
};

type SettingsEvents = {
  changed: [FlowSettings];
};

const ENV_BY_PROVIDER: Record<
  ApiProvider,
  'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY'
> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};
const MANAGED_AI_URL_ENV = 'FLOW_AI_PROXY_URL';
const MANAGED_AI_TOKEN_ENV = 'FLOW_AI_PROXY_TOKEN';

function defaultStoredSettings(): Required<
  Pick<
    StoredSettings,
    | 'onboardingCompleted'
    | 'aiConnectionMode'
    | 'selectedProvider'
    | 'privacyModeEnabled'
    | 'proactive'
    | 'meetingAssistant'
    | 'customCategories'
  >
> {
  return {
    onboardingCompleted: false,
    aiConnectionMode: 'managed',
    selectedProvider: 'gemini',
    privacyModeEnabled: false,
    proactive: DEFAULT_PROACTIVE_SETTINGS,
    meetingAssistant: DEFAULT_MEETING_ASSISTANT_SETTINGS,
    customCategories: [],
  };
}

function settingsDirectoryPath(): string {
  return getAppDataDirectoryPath();
}

export function getSettingsFilePath(): string {
  return path.join(settingsDirectoryPath(), 'settings.json');
}

function hasEnvKey(provider: ApiProvider): boolean {
  return (process.env[ENV_BY_PROVIDER[provider]] ?? '').trim().length > 0;
}

function normalizeCustomCategories(
  values: Array<Partial<WorkCategoryOption>> | undefined,
): WorkCategoryOption[] {
  const result: WorkCategoryOption[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeWorkCategoryOption(value);
    if (normalized == null || seen.has(normalized.value)) continue;
    seen.add(normalized.value);
    result.push(normalized);
  }
  return result.slice(0, 24);
}

class SettingsService extends EventEmitter<SettingsEvents> {
  private stored: StoredSettings = defaultStoredSettings();
  private loaded = false;

  async hydrate() {
    await this.ensureLoaded();
  }

  async getSettings(): Promise<FlowSettings> {
    await this.ensureLoaded();
    return this.publicSettings();
  }

  async updateSettings(patch: FlowSettingsPatch): Promise<FlowSettings> {
    await this.ensureLoaded();
    if (typeof patch.onboardingCompleted === 'boolean') {
      this.stored.onboardingCompleted = patch.onboardingCompleted;
    }
    this.stored.aiConnectionMode = 'managed';
    if (
      patch.selectedProvider === 'gemini' ||
      patch.selectedProvider === 'anthropic'
    ) {
      this.stored.selectedProvider = patch.selectedProvider;
    }
    if (typeof patch.privacyModeEnabled === 'boolean') {
      this.stored.privacyModeEnabled = patch.privacyModeEnabled;
    }
    if (patch.proactive != null) {
      this.stored.proactive = normalizeProactiveSettings({
        ...this.stored.proactive,
        ...patch.proactive,
      });
    }
    if (patch.meetingAssistant != null) {
      this.stored.meetingAssistant = normalizeMeetingAssistantSettings({
        ...this.stored.meetingAssistant,
        ...patch.meetingAssistant,
      });
    }
    if (patch.customCategories != null) {
      this.stored.customCategories = normalizeCustomCategories(
        patch.customCategories,
      );
    }
    await this.persistAndNotify();
    return this.publicSettings();
  }

  async setApiKey(provider: ApiProvider, value: string): Promise<FlowSettings> {
    await this.ensureLoaded();
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return this.clearApiKey(provider);
    }
    this.stored.apiKeys = this.stored.apiKeys ?? {};
    this.stored.apiKeys[provider] = encryptApiKey(trimmed);
    this.stored.validation = {
      ...this.stored.validation,
      [provider]: {
        lastValidatedAt: null,
        validationStatus: 'untested',
        validationMessage: 'Saved locally. Not validated yet.',
      },
    };
    await this.persistAndNotify();
    return this.publicSettings();
  }

  async clearApiKey(provider: ApiProvider): Promise<FlowSettings> {
    await this.ensureLoaded();
    if (this.stored.apiKeys != null) {
      delete this.stored.apiKeys[provider];
    }
    if (this.stored.validation != null) {
      delete this.stored.validation[provider];
    }
    await this.persistAndNotify();
    return this.publicSettings();
  }

  async validateApiKey(provider: ApiProvider): Promise<ApiKeyValidationResult> {
    await this.ensureLoaded();
    const checkedAt = new Date().toISOString();
    const apiKey = this.getApiKey(provider).trim();
    if (apiKey.length === 0) {
      const result = {
        provider,
        ok: false,
        status: 'invalid' as const,
        message: `No ${providerLabel(provider)} API key is configured.`,
        checkedAt,
      };
      await this.recordValidation(provider, result);
      return result;
    }

    const result =
      provider === 'gemini'
        ? await validateGeminiKey(apiKey, checkedAt)
        : await validateAnthropicKey(apiKey, checkedAt);
    await this.recordValidation(provider, result);
    return result;
  }

  getApiKey(provider: ApiProvider): string {
    const stored = this.stored.apiKeys?.[provider];
    if (stored != null) {
      try {
        return decryptApiKey(stored);
      } catch {
        return '';
      }
    }
    return process.env[ENV_BY_PROVIDER[provider]] ?? '';
  }

  getSelectedProvider(): ApiProvider {
    return this.stored.selectedProvider === 'anthropic'
      ? 'anthropic'
      : 'gemini';
  }

  getAiConnectionMode(): AiConnectionMode {
    return 'managed';
  }

  getManagedAiConfig(): {
    baseUrl: string;
    authToken: string | null;
    local: boolean;
  } | null {
    const baseUrl = process.env[MANAGED_AI_URL_ENV]?.trim();
    if (baseUrl == null || baseUrl.length === 0) return null;
    return {
      baseUrl,
      authToken: process.env[MANAGED_AI_TOKEN_ENV]?.trim() || null,
      local: isLocalManagedAiUrl(baseUrl),
    };
  }

  publicSettings(): FlowSettings {
    const defaults = defaultStoredSettings();
    const managedAiConfig = this.getManagedAiConfig();
    return {
      onboardingCompleted:
        this.stored.onboardingCompleted ?? defaults.onboardingCompleted,
      aiConnectionMode: this.getAiConnectionMode(),
      selectedProvider: this.getSelectedProvider(),
      privacyModeEnabled:
        this.stored.privacyModeEnabled ?? defaults.privacyModeEnabled,
      managedAi: {
        configured: managedAiConfig != null,
        endpoint:
          managedAiConfig != null
            ? publicManagedAiEndpoint(managedAiConfig.baseUrl)
            : null,
        authenticated: managedAiConfig?.authToken != null,
      },
      proactive: normalizeProactiveSettings(this.stored.proactive),
      meetingAssistant: normalizeMeetingAssistantSettings(
        this.stored.meetingAssistant,
      ),
      customCategories: normalizeCustomCategories(this.stored.customCategories),
      apiKeys: {
        gemini: this.apiKeyStatus('gemini'),
        anthropic: this.apiKeyStatus('anthropic'),
      },
    };
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    await fs.mkdir(settingsDirectoryPath(), { recursive: true });
    try {
      const raw = await fs.readFile(getSettingsFilePath(), 'utf8');
      const parsed = JSON.parse(raw) as StoredSettings;
      this.stored = {
        ...defaultStoredSettings(),
        ...parsed,
        aiConnectionMode: 'managed',
      };
    } catch (error) {
      if (
        error == null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
      this.stored = defaultStoredSettings();
      await this.persist();
    }
    this.loaded = true;
    this.configureRuntimeKeys();
  }

  private async recordValidation(
    provider: ApiProvider,
    result: ApiKeyValidationResult,
  ) {
    this.stored.validation = {
      ...this.stored.validation,
      [provider]: {
        lastValidatedAt: result.checkedAt,
        validationStatus: result.status,
        validationMessage: result.message,
      },
    };
    await this.persistAndNotify();
  }

  private apiKeyStatus(provider: ApiProvider): ApiKeyStatus {
    const stored = this.stored.apiKeys?.[provider];
    const validation = this.stored.validation?.[provider];
    const envConfigured = hasEnvKey(provider);
    return {
      configured: stored != null || envConfigured,
      source: stored != null ? 'stored' : envConfigured ? 'env' : 'missing',
      encrypted: stored?.encrypted ?? false,
      lastValidatedAt: validation?.lastValidatedAt ?? null,
      validationStatus: validation?.validationStatus ?? 'untested',
      validationMessage: validation?.validationMessage ?? null,
    };
  }

  private async persistAndNotify() {
    await this.persist();
    this.configureRuntimeKeys();
    this.emit('changed', this.publicSettings());
  }

  private async persist() {
    await fs.mkdir(settingsDirectoryPath(), { recursive: true });
    const temporaryPath = `${getSettingsFilePath()}.tmp`;
    await fs.writeFile(
      temporaryPath,
      JSON.stringify(this.stored, null, 2),
      'utf8',
    );
    await fs.rename(temporaryPath, getSettingsFilePath());
  }

  private configureRuntimeKeys() {
    configureApiKeys({
      GEMINI_API_KEY: this.getApiKey('gemini'),
      ANTHROPIC_API_KEY: this.getApiKey('anthropic'),
    });
  }
}

function encryptApiKey(value: string): StoredApiKey {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      value: safeStorage.encryptString(value).toString('base64'),
      encrypted: true,
    };
  }
  return {
    value: Buffer.from(value, 'utf8').toString('base64'),
    encrypted: false,
  };
}

function decryptApiKey(stored: StoredApiKey): string {
  const buffer = Buffer.from(stored.value, 'base64');
  if (stored.encrypted) {
    return safeStorage.decryptString(buffer);
  }
  return buffer.toString('utf8');
}

function providerLabel(provider: ApiProvider): string {
  return provider === 'gemini' ? 'Gemini' : 'Anthropic';
}

function publicManagedAiEndpoint(baseUrl: string): string {
  if (isLocalManagedAiUrl(baseUrl)) {
    return 'local dev adapter';
  }
  try {
    const url = new URL(baseUrl);
    return url.origin;
  } catch {
    return 'configured';
  }
}

function isLocalManagedAiUrl(baseUrl: string): boolean {
  return ['local', 'local-dev', 'in-process'].includes(
    baseUrl.trim().toLowerCase(),
  );
}

function normalizeProactiveSettings(
  value: Partial<ProactiveSettings> | undefined,
): ProactiveSettings {
  const next = {
    ...DEFAULT_PROACTIVE_SETTINGS,
    ...(value ?? {}),
  };
  return {
    proactiveEnabled: Boolean(next.proactiveEnabled),
    companionEnabled: Boolean(next.companionEnabled),
    preMeetingBriefsEnabled: Boolean(next.preMeetingBriefsEnabled),
    postMeetingNotesEnabled: Boolean(next.postMeetingNotesEnabled),
    returnToTaskEnabled: Boolean(next.returnToTaskEnabled),
    lowConfidenceCorrectionsEnabled: Boolean(
      next.lowConfidenceCorrectionsEnabled,
    ),
    endOfDaySummaryEnabled: Boolean(next.endOfDaySummaryEnabled),
    quietHoursEnabled: Boolean(next.quietHoursEnabled),
    quietHoursStart: normalizeClockTime(next.quietHoursStart, '18:00'),
    quietHoursEnd: normalizeClockTime(next.quietHoursEnd, '08:00'),
    intensity: ['quiet', 'balanced', 'active'].includes(next.intensity)
      ? next.intensity
      : DEFAULT_PROACTIVE_SETTINGS.intensity,
    companionPosition: ['bottom-right', 'right-center', 'bottom-left'].includes(
      next.companionPosition,
    )
      ? next.companionPosition
      : DEFAULT_PROACTIVE_SETTINGS.companionPosition,
    companionCustomPosition: normalizeCompanionCustomPosition(
      next.companionCustomPosition,
    ),
  };
}

function normalizeMeetingAssistantSettings(
  value: Partial<MeetingAssistantSettings> | undefined,
): MeetingAssistantSettings {
  const next = {
    ...DEFAULT_MEETING_ASSISTANT_SETTINGS,
    ...(value ?? {}),
  };
  return {
    enabled: Boolean(next.enabled),
    askBeforeRecording: Boolean(next.askBeforeRecording),
    systemAudioEnabled: Boolean(next.systemAudioEnabled),
    microphoneEnabled: Boolean(next.microphoneEnabled),
    saveRawAudio: Boolean(next.saveRawAudio),
    deleteRawAudioAfterTranscription: Boolean(
      next.deleteRawAudioAfterTranscription,
    ),
    defaultConsentReminderAccepted: Boolean(
      next.defaultConsentReminderAccepted,
    ),
    enabledApps: normalizeEnabledMeetingApps(next.enabledApps),
  };
}

function normalizeEnabledMeetingApps(value: unknown): string[] {
  const defaults = DEFAULT_MEETING_ASSISTANT_SETTINGS.enabledApps;
  if (!Array.isArray(value)) return defaults;
  const apps = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return apps.length > 0 ? Array.from(new Set(apps)) : defaults;
}

function normalizeCompanionCustomPosition(
  value: ProactiveSettings['companionCustomPosition'] | undefined,
): ProactiveSettings['companionCustomPosition'] {
  if (value == null) return null;
  return Number.isFinite(value.x) && Number.isFinite(value.y)
    ? {
        x: Math.round(value.x),
        y: Math.round(value.y),
      }
    : null;
}

function normalizeClockTime(value: string, fallback: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

async function validateGeminiKey(
  apiKey: string,
  checkedAt: string,
): Promise<ApiKeyValidationResult> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        apiKey,
      )}`,
    );
    return {
      provider: 'gemini',
      ok: response.ok,
      status: response.ok ? 'valid' : 'invalid',
      message: response.ok
        ? 'Gemini key validated.'
        : `Gemini rejected the key (${response.status}).`,
      checkedAt,
    };
  } catch (error) {
    return {
      provider: 'gemini',
      ok: false,
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Gemini validation failed.',
      checkedAt,
    };
  }
}

async function validateAnthropicKey(
  apiKey: string,
  checkedAt: string,
): Promise<ApiKeyValidationResult> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    return {
      provider: 'anthropic',
      ok: response.ok,
      status: response.ok ? 'valid' : 'invalid',
      message: response.ok
        ? 'Anthropic key validated.'
        : `Anthropic rejected the key (${response.status}).`,
      checkedAt,
    };
  } catch (error) {
    return {
      provider: 'anthropic',
      ok: false,
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Anthropic validation failed.',
      checkedAt,
    };
  }
}

export const settingsService = new SettingsService();

export function registerSettingsIpcHandlers() {
  ipcMain.handle('flow:settings:getSettings', () =>
    settingsService.getSettings(),
  );
  ipcMain.handle('flow:settings:updateSettings', (_event, patch) =>
    settingsService.updateSettings(patch),
  );
  ipcMain.handle('flow:settings:setApiKey', (_event, provider, value) =>
    settingsService.setApiKey(provider, value),
  );
  ipcMain.handle('flow:settings:clearApiKey', (_event, provider) =>
    settingsService.clearApiKey(provider),
  );
  ipcMain.handle('flow:settings:validateApiKey', (_event, provider) =>
    settingsService.validateApiKey(provider),
  );
}
