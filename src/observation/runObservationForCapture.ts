import type {
  CaptureInspectionPayload,
  CaptureMetadataPayload,
  ContextSnapshotPayload,
} from '../types/contextCapture';
import {hasCapturePrivacyScreening} from '../privacy/redaction';
import {generateObservation, DEFAULT_OBSERVATION_MODEL} from './geminiObservationEngine';
import type {ObservationRun, StructuredObservation} from './types';

export type ObservationCapturePreview = {
  dataUri: string | null;
  mimeType: string | null;
  metadata: CaptureMetadataPayload;
  ocrText: string | null;
};

export type ObserveCaptureArgs = {
  preview: ObservationCapturePreview | null;
  inspection: CaptureInspectionPayload | null;
  currentContext: ContextSnapshotPayload | null;
  recentObservations: StructuredObservation[];
  model?: string;
};

function toBase64Payload(dataUri: string | null): string | null {
  if (dataUri == null) {
    return null;
  }

  const separatorIndex = dataUri.indexOf(',');
  return separatorIndex >= 0 ? dataUri.slice(separatorIndex + 1) : dataUri;
}

export function validateCaptureForObservation(args: ObserveCaptureArgs): {
  imageBase64: string;
  imageMimeType: string;
} {
  const imageBase64 = toBase64Payload(args.preview?.dataUri ?? null);
  const imageMimeType = args.preview?.mimeType ?? null;

  if (
    args.preview == null ||
    args.inspection == null ||
    args.preview.metadata.status !== 'captured' ||
    !hasCapturePrivacyScreening(args.preview.metadata) ||
    imageBase64 == null ||
    imageMimeType == null
  ) {
    throw new Error(
      'Capture a privacy-screened screenshot before running a real observation.',
    );
  }

  return {
    imageBase64,
    imageMimeType,
  };
}

export async function generateStructuredObservationForCapture(
  args: ObserveCaptureArgs,
): Promise<ObservationRun> {
  const {imageBase64, imageMimeType} = validateCaptureForObservation(args);

  return generateObservation(
    {
      imageBase64,
      imageMimeType,
      ocrText: args.preview?.ocrText ?? null,
      inspection: args.inspection!,
      capture: args.preview!.metadata,
      currentContext: args.currentContext,
      recentObservations: args.recentObservations,
    },
    args.model ?? DEFAULT_OBSERVATION_MODEL,
  );
}
