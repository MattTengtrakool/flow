import { useState } from 'react';

import type { PermissionsStatus } from '../../../src/types/contextCapture';
import type { FlowSettings, FlowSettingsPatch } from '../../shared/flowApi';

type SettingsController = {
  settings: FlowSettings;
  updateSettings: (patch: FlowSettingsPatch) => Promise<FlowSettings>;
};

export function Onboarding(props: {
  permissions: PermissionsStatus | null;
  permissionStatus: string;
  settingsController: SettingsController;
  onRefreshPermissions: () => void;
  onRequestAccessibility: () => Promise<unknown>;
  onRequestScreen: () => Promise<unknown>;
  onStartSession: () => void;
}) {
  const { settings } = props.settingsController;
  const [message, setMessage] = useState<string | null>(null);

  const setupState = {
    hasKey: settings.managedAi.configured,
    hasAccessibility: props.permissions?.accessibilityTrusted === true,
    hasScreen: props.permissions?.captureAccessGranted === true,
  };
  const canFinish =
    setupState.hasKey && setupState.hasAccessibility && setupState.hasScreen;

  return (
    <main className="onboarding-shell">
      <section className="onboarding-panel">
        <div className="onboarding-copy">
          <p className="eyebrow">Welcome to Flow</p>
          <h1>Your private work memory for macOS.</h1>
          <p>
            Flow watches your desktop context, turns it into structured work
            blocks, and keeps the log on this Mac. You control capture,
            permissions, and privacy mode.
          </p>
        </div>

        <div className="setup-steps">
          <article className="setup-step">
            <span
              className={setupState.hasKey ? 'step-dot done' : 'step-dot'}
            />
            <div>
              <h2>Connect Managed Flow AI</h2>
              <p>
                Flow uses the managed relay for model calls. Provider keys stay
                server-side and are never pasted into this desktop app.
              </p>
              <div className="managed-ai-card">
                <strong>
                  {settings.managedAi.configured
                    ? 'Managed AI is ready'
                    : 'Managed AI needs a relay URL'}
                </strong>
                <span>
                  {settings.managedAi.configured
                    ? `Requests go through ${settings.managedAi.endpoint}. No provider key is stored in the app.`
                    : 'Set FLOW_AI_PROXY_URL in .env or the launch environment, then restart Electron.'}
                </span>
              </div>
              {message != null ? (
                <p className="setup-message">{message}</p>
              ) : null}
            </div>
          </article>

          <article className="setup-step">
            <span
              className={
                setupState.hasAccessibility ? 'step-dot done' : 'step-dot'
              }
            />
            <div>
              <h2>Allow Accessibility</h2>
              <p>
                Flow uses this to understand the active app and window context.
              </p>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  props
                    .onRequestAccessibility()
                    .finally(props.onRefreshPermissions);
                }}
              >
                Open Accessibility prompt
              </button>
            </div>
          </article>

          <article className="setup-step">
            <span
              className={setupState.hasScreen ? 'step-dot done' : 'step-dot'}
            />
            <div>
              <h2>Allow Screen Recording</h2>
              <p>
                Flow reads privacy-screened captures and stores only sanitized
                events.
              </p>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  props.onRequestScreen().finally(props.onRefreshPermissions);
                }}
              >
                Open Screen Recording prompt
              </button>
            </div>
          </article>
        </div>

        <footer className="onboarding-footer">
          <span>{props.permissionStatus}</span>
          <button
            type="button"
            className="button-primary"
            disabled={!canFinish}
            onClick={() => {
              props.settingsController
                .updateSettings({
                  aiConnectionMode: 'managed',
                  onboardingCompleted: true,
                })
                .then(() => props.onStartSession())
                .catch(error =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Could not finish setup.',
                  ),
                );
            }}
          >
            Start first session
          </button>
        </footer>
      </section>
    </main>
  );
}
