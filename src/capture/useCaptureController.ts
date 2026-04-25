import {useState} from 'react';

import {
  captureNow,
  getPermissionsStatus,
  inspectCaptureTarget,
  requestAccessibilityPrompt,
  requestScreenCaptureAccess,
} from '../native/contextCaptureBridge';
import {
  createDomainId,
  type DomainEvent,
} from '../timeline/eventLog';
import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  PermissionsStatus,
} from '../types/contextCapture';
import {
  sanitizeCaptureMetadata,
  sanitizeInspection,
} from '../privacy/redaction';

export type CapturePreviewState = {
  dataUri: string | null;
  mimeType: string | null;
  metadata: CaptureMetadataPayload;
  ocrText: string | null;
};

const DEFAULT_PERMISSIONS: PermissionsStatus = {
  accessibilityTrusted: false,
  captureAccessGranted: false,
  hostBundleIdentifier: null,
  hostBundlePath: null,
};

export function useCaptureController(args: {
  appendEvent: (event: DomainEvent) => void;
  appendEvents: (events: DomainEvent[]) => void;
  setErrorMessage: (message: string | null) => void;
}) {
  const [permissions, setPermissions] =
    useState<PermissionsStatus>(DEFAULT_PERMISSIONS);
  const [latestInspection, setLatestInspection] =
    useState<CaptureInspectionPayload | null>(null);
  const [latestCapturePreview, setLatestCapturePreview] =
    useState<CapturePreviewState | null>(null);

  async function refreshPermissions() {
    setPermissions(await getPermissionsStatus());
  }

  async function promptForAccessibility() {
    try {
      setPermissions(await requestAccessibilityPrompt());
      args.setErrorMessage(null);
    } catch (error) {
      args.setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to request accessibility permission.',
      );
    }
  }

  async function requestScreenCapturePermission() {
    try {
      setPermissions(await requestScreenCaptureAccess());
      args.setErrorMessage(null);
    } catch (error) {
      args.setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to request screen capture permission.',
      );
    }
  }

  async function runCaptureInspection() {
    try {
      const inspection = await inspectCaptureTarget();
      setLatestInspection(inspection);
      args.appendEvent({
        id: createDomainId('event'),
        type: 'capture_target_resolved',
        inspectionId: createDomainId('inspection'),
        inspection: sanitizeInspection(inspection),
        occurredAt: inspection.inspectedAt,
      });
    } catch (error) {
      args.setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to inspect the capture target.',
      );
    }
  }

  async function runCaptureNow(): Promise<{
    preview: CapturePreviewState;
    inspection: CaptureInspectionPayload;
  } | null> {
    try {
      const result = await captureNow();
      const previewDataUri =
        result.previewBase64 != null && result.previewMimeType != null
          ? `data:${result.previewMimeType};base64,${result.previewBase64}`
          : null;
      const captureMetadata = sanitizeCaptureMetadata({
        ...result.metadata,
        staleFrame: false,
        blankFrame: false,
      });
      const preview: CapturePreviewState = {
        dataUri: previewDataUri,
        mimeType: result.previewMimeType,
        metadata: captureMetadata,
        ocrText: result.ocrText,
      };
      setLatestInspection(result.inspection);
      setLatestCapturePreview(preview);
      setPermissions({
        accessibilityTrusted: result.inspection.context.accessibilityTrusted,
        captureAccessGranted: result.inspection.captureAccessGranted,
        hostBundleIdentifier: result.inspection.context.hostBundleIdentifier,
        hostBundlePath: result.inspection.context.hostBundlePath,
      });
      args.setErrorMessage(null);
      args.appendEvents([
        {
          id: createDomainId('event'),
          type: 'capture_target_resolved',
          inspectionId: createDomainId('inspection'),
          inspection: sanitizeInspection(result.inspection),
          occurredAt: result.inspection.inspectedAt,
        },
        {
          id: createDomainId('event'),
          type: 'capture_performed',
          captureId: createDomainId('capture'),
          capture: captureMetadata,
          occurredAt: captureMetadata.capturedAt,
        },
      ]);
      return {preview, inspection: result.inspection};
    } catch (error) {
      args.setErrorMessage(
        error instanceof Error ? error.message : 'Failed to capture a screenshot.',
      );
      return null;
    }
  }

  return {
    permissions,
    latestInspection,
    latestCapturePreview,
    refreshPermissions,
    promptForAccessibility,
    requestScreenCapturePermission,
    runCaptureInspection,
    runCaptureNow,
  };
}
