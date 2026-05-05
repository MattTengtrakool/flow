import { memo, useState } from 'react';

import type {
  CalendarSourceMode,
  CalendarStatePayload,
} from '../../../src/calendar/types';
import type { CostSummary } from '../../../src/planner/costSummary';
import type { FlowSettings, FlowSettingsPatch } from '../../shared/flowApi';
import {
  WORK_CATEGORY_OPTIONS,
  normalizeWorkCategoryOption,
} from '../../../src/workCategories';
import type { TimelineUiState } from '../types';
import { MetricCard } from '../components/MetricCard';
import { Screen } from '../components/common';

type SettingsController = {
  settings: FlowSettings;
  updateSettings: (patch: FlowSettingsPatch) => Promise<FlowSettings>;
};

type CalendarController = CalendarStatePayload & {
  connectGoogleAccount: () => Promise<CalendarStatePayload>;
  disconnectGoogleAccount: (accountId: string) => Promise<CalendarStatePayload>;
  syncNow: () => Promise<CalendarStatePayload>;
  updateCalendarSelection: (
    accountId: string,
    calendarId: string,
    enabled: boolean,
  ) => Promise<CalendarStatePayload>;
  updateCalendarSourceMode: (
    accountId: string,
    calendarId: string,
    mode: CalendarSourceMode,
  ) => Promise<CalendarStatePayload>;
};

export const SettingsScreen = memo(function SettingsScreen(props: {
  version: string;
  permissionStatus: string;
  timelineStore: TimelineUiState;
  costSummary: CostSummary;
  settingsController: SettingsController;
  calendarState: CalendarController;
  onCaptureNow: () => void;
  onReplanNow: () => void;
}) {
  const { timelineStore } = props;
  const { settings } = props.settingsController;
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [categoryLabelDraft, setCategoryLabelDraft] = useState('');
  const [categoryDescriptionDraft, setCategoryDescriptionDraft] = useState('');
  const [confirmDisconnectAccountId, setConfirmDisconnectAccountId] = useState<
    string | null
  >(null);
  const calendarAccountCount = props.calendarState.accounts.length;
  const calendarConnectionLabel =
    calendarAccountCount > 0
      ? `${calendarAccountCount} ${
          calendarAccountCount === 1 ? 'account' : 'accounts'
        } connected`
      : props.calendarState.oauthClientConfigured
      ? 'Ready to connect'
      : 'Set GOOGLE_OAUTH_CLIENT_ID to connect';
  const updateProactiveSettings = (
    patch: Partial<FlowSettings['proactive']>,
    fallbackMessage: string,
  ) => {
    props.settingsController
      .updateSettings({
        proactive: {
          ...settings.proactive,
          ...patch,
        },
      })
      .catch(error =>
        setSettingsMessage(
          error instanceof Error ? error.message : fallbackMessage,
        ),
      );
  };
  const updateMeetingSettings = (
    patch: Partial<FlowSettings['meetingAssistant']>,
    fallbackMessage: string,
  ) => {
    props.settingsController
      .updateSettings({
        meetingAssistant: {
          ...settings.meetingAssistant,
          ...patch,
        },
      })
      .catch(error =>
        setSettingsMessage(
          error instanceof Error ? error.message : fallbackMessage,
        ),
      );
  };
  const addCustomCategory = () => {
    const normalized = normalizeWorkCategoryOption({
      label: categoryLabelDraft,
      description: categoryDescriptionDraft,
    });
    if (normalized == null) {
      setSettingsMessage('Add a category name first.');
      return;
    }
    props.settingsController
      .updateSettings({
        customCategories: [
          ...settings.customCategories.filter(
            category => category.value !== normalized.value,
          ),
          normalized,
        ],
      })
      .then(() => {
        setCategoryLabelDraft('');
        setCategoryDescriptionDraft('');
        setSettingsMessage('Category saved.');
      })
      .catch(error =>
        setSettingsMessage(
          error instanceof Error ? error.message : 'Could not save category.',
        ),
      );
  };
  const removeCustomCategory = (value: string) => {
    props.settingsController
      .updateSettings({
        customCategories: settings.customCategories.filter(
          category => category.value !== value,
        ),
      })
      .catch(error =>
        setSettingsMessage(
          error instanceof Error ? error.message : 'Could not remove category.',
        ),
      );
  };

  return (
    <Screen title="Settings">
      <div className="settings-section">
        <h3>Setup</h3>
        <div className="settings-panel">
          <label className="settings-toggle">
            <span>
              <strong>Privacy mode</strong>
              <small>Pause capture and observation while this is on.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.privacyModeEnabled}
              onChange={event => {
                props.settingsController
                  .updateSettings({ privacyModeEnabled: event.target.checked })
                  .catch(error =>
                    setSettingsMessage(
                      error instanceof Error
                        ? error.message
                        : 'Could not update privacy mode.',
                    ),
                  );
              }}
            />
          </label>
          <div className="managed-ai-card">
            <strong>
              {settings.managedAi.configured
                ? 'Managed Flow AI is ready'
                : 'Managed Flow AI is unavailable'}
            </strong>
            <span>
              {settings.managedAi.configured
                ? `Endpoint: ${settings.managedAi.endpoint}. Provider keys stay on the Flow relay.`
                : 'Set FLOW_AI_PROXY_URL in .env or the launch environment, then restart Electron.'}
            </span>
          </div>
          <div className="api-key-card">
            <div>
              <strong>Provider keys</strong>
              <span>
                Model provider credentials are configured on the managed relay,
                not in the desktop app.
              </span>
            </div>
          </div>
          {settingsMessage != null ? (
            <p className="setup-message">{settingsMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="settings-section">
        <h3>Work categories</h3>
        <div className="settings-panel">
          <p>
            Add custom categories for your work. Built-in categories stay
            available, and custom ones show up in correction controls and planner
            prompts.
          </p>
          <div className="settings-grid two">
            <label>
              <span>Category name</span>
              <input
                value={categoryLabelDraft}
                onChange={event => setCategoryLabelDraft(event.target.value)}
                placeholder="e.g. Fundraising"
              />
            </label>
            <label>
              <span>Description</span>
              <input
                value={categoryDescriptionDraft}
                onChange={event =>
                  setCategoryDescriptionDraft(event.target.value)
                }
                placeholder="What this category means"
              />
            </label>
          </div>
          <button type="button" className="button-secondary" onClick={addCustomCategory}>
            Add category
          </button>
          <div className="chip-row">
            {settings.customCategories.map(category => (
              <button
                key={category.value}
                type="button"
                className="chip button-ghost"
                onClick={() => removeCustomCategory(category.value)}
                title="Remove category"
              >
                {category.label} ×
              </button>
            ))}
          </div>
          <small>
            Built-ins: {WORK_CATEGORY_OPTIONS.map(category => category.label).join(', ')}
          </small>
        </div>
      </div>

      <div className="settings-section">
        <h3>Flow Companion</h3>
        <div className="settings-panel">
          <label className="settings-toggle">
            <span>
              <strong>Enable proactive insights</strong>
              <small>Show timely pre-meeting and work-context nudges.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.proactiveEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { proactiveEnabled: event.target.checked },
                  'Could not update proactive insights.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Floating companion</strong>
              <small>Keep the small Flow companion visible on screen.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.companionEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { companionEnabled: event.target.checked },
                  'Could not update companion.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Pre-meeting briefs</strong>
              <small>
                Surface a compact brief before upcoming calendar events.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.preMeetingBriefsEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { preMeetingBriefsEnabled: event.target.checked },
                  'Could not update pre-meeting briefs.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Post-meeting notes</strong>
              <small>Suggest saving notes after meetings Flow observed.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.postMeetingNotesEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { postMeetingNotesEnabled: event.target.checked },
                  'Could not update post-meeting notes.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Return-to-task reminders</strong>
              <small>Notice when the active window matches recent work.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.returnToTaskEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { returnToTaskEnabled: event.target.checked },
                  'Could not update return-to-task reminders.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Low-confidence corrections</strong>
              <small>Ask for quick feedback on uncertain work blocks.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.lowConfidenceCorrectionsEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { lowConfidenceCorrectionsEnabled: event.target.checked },
                  'Could not update correction prompts.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>End-of-day summary</strong>
              <small>Offer a quiet wrap-up near the end of the day.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.endOfDaySummaryEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { endOfDaySummaryEnabled: event.target.checked },
                  'Could not update end-of-day summary.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Quiet hours</strong>
              <small>Keep Flow ambient during your off hours.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.proactive.quietHoursEnabled}
              onChange={event => {
                updateProactiveSettings(
                  { quietHoursEnabled: event.target.checked },
                  'Could not update quiet hours.',
                );
              }}
            />
          </label>
          <div className="settings-control-row">
            <div>
              <strong>Quiet window</strong>
              <small>Cards pause during this local time range.</small>
            </div>
            <div className="settings-time-row">
              <label>
                From
                <input
                  type="time"
                  value={settings.proactive.quietHoursStart}
                  onChange={event => {
                    updateProactiveSettings(
                      { quietHoursStart: event.target.value },
                      'Could not update quiet start time.',
                    );
                  }}
                />
              </label>
              <label>
                To
                <input
                  type="time"
                  value={settings.proactive.quietHoursEnd}
                  onChange={event => {
                    updateProactiveSettings(
                      { quietHoursEnd: event.target.value },
                      'Could not update quiet end time.',
                    );
                  }}
                />
              </label>
            </div>
          </div>
          <div className="settings-control-row">
            <div>
              <strong>Intensity</strong>
              <small>Limit expanded companion cards per hour.</small>
            </div>
            <span className="segmented-control compact">
              {PROACTIVE_INTENSITY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    settings.proactive.intensity === option.value
                      ? 'active'
                      : ''
                  }
                  onClick={() => {
                    updateProactiveSettings(
                      { intensity: option.value },
                      'Could not update companion intensity.',
                    );
                  }}
                >
                  {option.label}
                </button>
              ))}
            </span>
          </div>
          <div className="settings-control-row">
            <div>
              <strong>Companion position</strong>
              <small>
                Drag the companion anywhere, or choose a preset to reset.
              </small>
            </div>
            <span className="segmented-control compact">
              {COMPANION_POSITION_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    settings.proactive.companionPosition === option.value
                      ? 'active'
                      : ''
                  }
                  onClick={() => {
                    updateProactiveSettings(
                      {
                        companionPosition: option.value,
                        companionCustomPosition: null,
                      },
                      'Could not update companion position.',
                    );
                  }}
                >
                  {option.label}
                </button>
              ))}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Meeting notes</h3>
        <div className="settings-panel">
          <label className="settings-toggle">
            <span>
              <strong>Meeting assistant</strong>
              <small>
                Detect likely calls and ask before starting transcription.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.meetingAssistant.enabled}
              onChange={event => {
                updateMeetingSettings(
                  { enabled: event.target.checked },
                  'Could not update meeting assistant.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Ask before recording</strong>
              <small>Flow never starts meeting audio without a click.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.meetingAssistant.askBeforeRecording}
              onChange={event => {
                updateMeetingSettings(
                  { askBeforeRecording: event.target.checked },
                  'Could not update recording confirmation.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Consent reminder accepted</strong>
              <small>
                I have permission to record/transcribe meetings I start.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.meetingAssistant.defaultConsentReminderAccepted}
              onChange={event => {
                updateMeetingSettings(
                  {
                    defaultConsentReminderAccepted: event.target.checked,
                  },
                  'Could not update meeting consent reminder.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>System/app audio</strong>
              <small>Use Screen Recording permission for meeting audio.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.meetingAssistant.systemAudioEnabled}
              onChange={event => {
                updateMeetingSettings(
                  { systemAudioEnabled: event.target.checked },
                  'Could not update system audio.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Microphone audio</strong>
              <small>Optional and off by default.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.meetingAssistant.microphoneEnabled}
              onChange={event => {
                updateMeetingSettings(
                  { microphoneEnabled: event.target.checked },
                  'Could not update microphone audio.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Save raw audio</strong>
              <small>
                Leave off to keep only transcript text and metadata.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.meetingAssistant.saveRawAudio}
              onChange={event => {
                updateMeetingSettings(
                  { saveRawAudio: event.target.checked },
                  'Could not update raw audio policy.',
                );
              }}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Delete chunks after transcription</strong>
              <small>Raw chunks are temporary unless saving is enabled.</small>
            </span>
            <input
              type="checkbox"
              checked={
                settings.meetingAssistant.deleteRawAudioAfterTranscription
              }
              onChange={event => {
                updateMeetingSettings(
                  {
                    deleteRawAudioAfterTranscription: event.target.checked,
                  },
                  'Could not update audio cleanup.',
                );
              }}
            />
          </label>
          <div className="managed-ai-card">
            <strong>Detected apps</strong>
            <span>{settings.meetingAssistant.enabledApps.join(', ')}</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Calendar context</h3>
        <div className="settings-panel">
          <div className="calendar-settings-header">
            <div>
              <strong>Google Calendar</strong>
              <span>{calendarConnectionLabel}</span>
            </div>
            <div className="button-row compact">
              <button
                type="button"
                className="button-primary"
                disabled={
                  !props.calendarState.oauthClientConfigured ||
                  props.calendarState.status === 'syncing'
                }
                onClick={() => {
                  props.calendarState
                    .connectGoogleAccount()
                    .then(() =>
                      setSettingsMessage('Calendar account connected.'),
                    )
                    .catch(error =>
                      setSettingsMessage(
                        error instanceof Error
                          ? error.message
                          : 'Could not connect Google Calendar.',
                      ),
                    );
                }}
              >
                {calendarAccountCount > 0 ? 'Add account' : 'Connect account'}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={
                  calendarAccountCount === 0 ||
                  props.calendarState.status === 'syncing'
                }
                onClick={() => {
                  props.calendarState
                    .syncNow()
                    .then(() => setSettingsMessage('Calendar sync complete.'))
                    .catch(error =>
                      setSettingsMessage(
                        error instanceof Error
                          ? error.message
                          : 'Could not sync Google Calendar.',
                      ),
                    );
                }}
              >
                Sync now
              </button>
            </div>
          </div>
          {props.calendarState.errorMessage != null ? (
            <p className="setup-message">{props.calendarState.errorMessage}</p>
          ) : null}
          {props.calendarState.accounts.map(account => (
            <div key={account.id} className="calendar-account-card">
              <div className="calendar-account-card__header">
                <div>
                  <strong>{account.displayName ?? account.email}</strong>
                  <span>
                    {account.email} · {account.syncStatus}
                  </span>
                </div>
                <button
                  type="button"
                  className="button-danger-soft"
                  onClick={() => {
                    if (confirmDisconnectAccountId !== account.id) {
                      setConfirmDisconnectAccountId(account.id);
                      setSettingsMessage(
                        `Click Confirm disconnect to remove ${account.email}.`,
                      );
                      return;
                    }
                    props.calendarState
                      .disconnectGoogleAccount(account.id)
                      .then(() => {
                        setConfirmDisconnectAccountId(null);
                        setSettingsMessage('Calendar account removed.');
                      })
                      .catch(error =>
                        setSettingsMessage(
                          error instanceof Error
                            ? error.message
                            : 'Could not disconnect account.',
                        ),
                      );
                  }}
                >
                  {confirmDisconnectAccountId === account.id
                    ? 'Confirm disconnect'
                    : 'Disconnect'}
                </button>
              </div>
              {props.calendarState.sources
                .filter(source => source.accountId === account.id)
                .map(source => (
                  <label
                    key={source.id}
                    className="settings-toggle calendar-source-row"
                  >
                    <span>
                      <strong>{source.summary}</strong>
                      <small>
                        {source.primary ? 'Primary' : source.accessRole} ·{' '}
                        {sourceModeLabel(source.mode)}
                      </small>
                      <small className="calendar-source-mode-help">
                        {sourceModeDescription(source.mode)}
                      </small>
                    </span>
                    <span className="segmented-control compact">
                      {SOURCE_MODE_OPTIONS.map(option => (
                        <button
                          key={option.mode}
                          type="button"
                          className={
                            source.mode === option.mode ? 'active' : ''
                          }
                          onClick={() => {
                            props.calendarState
                              .updateCalendarSourceMode(
                                source.accountId,
                                source.externalId,
                                option.mode,
                              )
                              .catch(error =>
                                setSettingsMessage(
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not update calendar mode.',
                                ),
                              );
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3>System health</h3>
        <div className="metric-grid">
          <MetricCard label="App version" value={props.version} />
          <MetricCard label="Hydration" value={timelineStore.hydrationStatus} />
          <MetricCard label="Permissions" value={props.permissionStatus} />
          <MetricCard
            label="Privacy"
            value={timelineStore.privacyModeEnabled ? 'on' : 'off'}
          />
          <MetricCard
            label="Meeting audio"
            value={timelineStore.meetingTranscriptionStatus}
          />
          <MetricCard
            label="Last capture"
            value={
              timelineStore.continuousModeState.lastCapturedAt ?? 'not yet'
            }
          />
          <MetricCard
            label="Last observation"
            value={
              timelineStore.continuousModeState.lastObservedAt ?? 'not yet'
            }
          />
          <MetricCard
            label="Events"
            value={String(timelineStore.eventLogLength)}
          />
          <MetricCard
            label="Observations"
            value={String(timelineStore.timeline.observationOrder.length)}
          />
          <MetricCard
            label="Captures"
            value={String(timelineStore.timeline.captureRecordOrder.length)}
          />
          <MetricCard
            label="Plan snapshots"
            value={String(timelineStore.timeline.planSnapshots.length)}
          />
          <MetricCard
            label="Storage"
            value={timelineStore.storagePath ?? 'loading'}
          />
          <MetricCard
            label="Last saved"
            value={timelineStore.lastSavedAt ?? 'not yet'}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>Planner and cost</h3>
        <div className="metric-grid">
          <MetricCard
            label="Planner"
            value={
              timelineStore.plannerRuntimeState.inFlight
                ? 'planning'
                : timelineStore.plannerRuntimeState.lastFailureMessage ??
                  'ready'
            }
          />
          <MetricCard
            label="Last plan"
            value={timelineStore.plannerRuntimeState.lastRunAt ?? 'not yet'}
          />
          <MetricCard
            label="Total cost"
            value={`$${props.costSummary.allTime.costUsd.toFixed(4)}`}
          />
          <MetricCard
            label="Last 7 days"
            value={`$${props.costSummary.last7Days.costUsd.toFixed(4)}`}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>Recent activity</h3>
        <section className="panel-card">
          {timelineStore.recentActivity.length === 0 ? (
            <div className="insight-row">
              <span>No sanitized activity yet</span>
              <strong>0</strong>
            </div>
          ) : (
            timelineStore.recentActivity.map(item => (
              <div
                key={`${item.kind}:${item.occurredAt}`}
                className="insight-row"
              >
                <span>
                  {item.title} · {item.detail}
                </span>
                <strong>
                  {new Date(item.occurredAt).toLocaleTimeString()}
                </strong>
              </div>
            ))
          )}
        </section>
      </div>

      <div className="button-row">
        <button type="button" onClick={props.onCaptureNow}>
          Capture now
        </button>
        <button
          type="button"
          onClick={props.onReplanNow}
          disabled={timelineStore.plannerRuntimeState.inFlight}
        >
          Replan now
        </button>
      </div>
    </Screen>
  );
});

const SOURCE_MODE_OPTIONS: Array<{
  mode: CalendarSourceMode;
  label: string;
  description: string;
}> = [
  {
    mode: 'scheduled',
    label: 'Scheduled',
    description:
      'Shows as intended time, blocks availability, and informs Flow.',
  },
  {
    mode: 'context_only',
    label: 'Context',
    description:
      'Shows quietly and informs chat/planning without blocking fit.',
  },
  {
    mode: 'ignored',
    label: 'Ignore',
    description: 'Stops syncing and removes cached events for this calendar.',
  },
];

const PROACTIVE_INTENSITY_OPTIONS: Array<{
  value: FlowSettings['proactive']['intensity'];
  label: string;
}> = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'active', label: 'Active' },
];

const COMPANION_POSITION_OPTIONS: Array<{
  value: FlowSettings['proactive']['companionPosition'];
  label: string;
}> = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'right-center', label: 'Right center' },
  { value: 'bottom-left', label: 'Bottom left' },
];

function sourceModeLabel(mode: CalendarSourceMode): string {
  if (mode === 'scheduled') return 'scheduled';
  if (mode === 'context_only') return 'context only';
  return 'ignored';
}

function sourceModeDescription(mode: CalendarSourceMode): string {
  return (
    SOURCE_MODE_OPTIONS.find(option => option.mode === mode)?.description ??
    'Choose how Flow should treat this calendar.'
  );
}
