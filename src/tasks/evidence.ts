import type { ObservationView } from '../timeline/eventLog';
import {
  getObservationPossibleObjective,
  getObservationPossibleTask,
} from '../observation/intent';
import {
  isLowSignalWorkArtifact,
  normalizeProjects,
  normalizeTasks,
} from '../workArtifacts';

export type EvidenceAssignmentState =
  | 'candidate_evidence'
  | 'assigned_evidence'
  | 'background_evidence';

const TRANSIENT_TASK_RE =
  /\b(?:push(?:ing)?|commit(?:s|ted|ting)?|checkout|checking out|login|logging in|authenticat(?:e|ing)|localhost|github|slack channel|channel discussion|status check|opening|browsing)\b/i;

function hasUsefulText(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !isLowSignalWorkArtifact(trimmed);
}

export function observationHasStableWorkObject(
  observation: ObservationView,
): boolean {
  const structured = observation.structured;
  if (structured == null) return false;

  const projects = normalizeProjects(structured.entities);
  const tasks = normalizeTasks(structured.entities);
  const hasTask = tasks.some(hasUsefulText);
  const hasProject = projects.some(hasUsefulText);
  const hasDocument = structured.entities.documents.some(hasUsefulText);
  const hasTicket = structured.entities.tickets.some(hasUsefulText);
  const hasHypothesis = hasUsefulText(getObservationPossibleObjective(structured));

  return hasTask || hasProject || hasDocument || hasTicket || hasHypothesis;
}

export function isLikelyTransientEvidence(observation: ObservationView): boolean {
  const structured = observation.structured;
  if (structured == null) return true;

  const text = [
    structured.summary,
    getObservationPossibleTask(structured) ?? '',
    getObservationPossibleObjective(structured) ?? '',
    structured.nextAction ?? '',
    ...structured.artifacts,
    ...structured.entities.apps,
    ...structured.entities.documents,
    ...structured.entities.urls,
  ].join(' ');
  if (TRANSIENT_TASK_RE.test(text)) return true;

  return structured.activityType === 'communication' && !hasUsefulText(structured.nextAction);
}

export function isObservationBlockWorthy(
  observation: ObservationView,
): boolean {
  const structured = observation.structured;
  if (structured == null) return false;
  if (structured.activityType === 'meeting') return true;
  if (!observationHasStableWorkObject(observation)) return false;
  if (isLikelyTransientEvidence(observation)) {
    return structured.activityType === 'coding' || structured.activityType === 'writing';
  }
  return true;
}

export function evidenceStateForDecision(
  decision: string,
): EvidenceAssignmentState {
  if (decision === 'ignore') return 'background_evidence';
  if (decision === 'hold_pending') return 'candidate_evidence';
  return 'assigned_evidence';
}
