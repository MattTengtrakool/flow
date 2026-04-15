export type RectValue = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContextSnapshotPayload = {
  hostBundleIdentifier: string | null;
  hostBundlePath: string | null;
  appName: string | null;
  bundleIdentifier: string | null;
  processId: number | null;
  windowTitle: string | null;
  windowFrame: RectValue | null;
  source: 'app' | 'window';
  preciseModeEnabled: boolean;
  accessibilityTrusted: boolean;
  captureAccessGranted: boolean;
  isIdle: boolean;
  idleSeconds: number;
  changeReasons: string[];
  recordedAt: string;
};

export type CaptureTargetType = 'window' | 'application' | 'none';

export type CaptureTargetSummary = {
  targetType: CaptureTargetType;
  appName: string | null;
  bundleIdentifier: string | null;
  processId: number | null;
  windowId: number | null;
  windowTitle: string | null;
  displayId: number | null;
  frame: RectValue | null;
};

export type CaptureCandidatePayload = CaptureTargetSummary & {
  score: number;
  reasons: string[];
  isOnScreen: boolean;
  isActive: boolean;
};

export type CaptureInspectionPayload = {
  inspectedAt: string;
  context: ContextSnapshotPayload;
  captureAccessGranted: boolean;
  chosenTargetType: CaptureTargetType;
  confidence: number;
  fallbackReason: string | null;
  chosenTarget: CaptureTargetSummary | null;
  candidates: CaptureCandidatePayload[];
};

export type CapturePrivacyRedactionPayload = {
  checked: boolean;
  applied: boolean;
  version: string;
  matchCount: number;
  matchTypes: string[];
};

export type CaptureMetadataPayload = {
  capturedAt: string;
  status: 'captured' | 'permission_required' | 'error';
  targetType: CaptureTargetType;
  appName: string | null;
  bundleIdentifier: string | null;
  processId: number | null;
  windowId: number | null;
  windowTitle: string | null;
  displayId: number | null;
  confidence: number;
  width: number | null;
  height: number | null;
  frameHash: string | null;
  perceptualHash: string | null;
  errorMessage: string | null;
  previewByteLength: number;
  privacyRedaction: CapturePrivacyRedactionPayload;
  staleFrame: boolean;
  blankFrame: boolean;
};

export type PermissionsStatus = {
  accessibilityTrusted: boolean;
  captureAccessGranted: boolean;
  hostBundleIdentifier: string | null;
  hostBundlePath: string | null;
};

export type CaptureResultPayload = {
  inspection: CaptureInspectionPayload;
  metadata: Omit<CaptureMetadataPayload, 'staleFrame' | 'blankFrame'>;
  previewBase64: string | null;
  previewMimeType: string | null;
  ocrText: string | null;
};
