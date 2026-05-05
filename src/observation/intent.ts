import type { StructuredObservation } from './types';

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function getObservationPossibleTask(
  observation: StructuredObservation,
): string | null {
  return clean(observation.possibleTask) ?? clean(observation.taskHypothesis);
}

export function getObservationPossibleObjective(
  observation: StructuredObservation,
): string | null {
  return (
    clean(observation.possibleObjective) ??
    clean(observation.possibleTask) ??
    clean(observation.taskHypothesis)
  );
}

export function getObservationPossibleProject(
  observation: StructuredObservation,
): string | null {
  return clean(observation.possibleProject) ?? observation.entities.projects?.[0] ?? null;
}

export function getObservationVisibleAction(
  observation: StructuredObservation,
): string | null {
  return clean(observation.visibleAction) ?? clean(observation.summary);
}
