import React from 'react';
import {Image, Text, View} from 'react-native';

import {DEFAULT_TASK_ENGINE_POLICY} from './policy';
import type {TaskDecisionView} from './types';
import type {ObservationView} from '../state/eventLog';

type TaskDecisionListProps = {
  decisions: TaskDecisionView[];
  observationsById: Record<string, ObservationView>;
  formatTimestamp: (value?: string | null) => string;
  styles: {
    emptyState: object;
    fixtureList: object;
    fixtureRow: object;
    fixtureTitle: object;
    fixtureMeta: object;
    fieldHelp: object;
    warningBadge: object;
    warningBadgeText: object;
    taskObservationRow: object;
    taskObservationImage: object;
    taskObservationBody: object;
  };
};

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : 'n/a';
}

function describeDecisionMode(decision: TaskDecisionView): string {
  if (decision.decisionMode === 'deterministic') {
    return `Deterministic means the engine chose locally from rules and scores without calling Gemini. Confidence ${formatScore(decision.confidence)} is the winning candidate score, not the observation model confidence.`;
  }

  if (decision.decisionMode === 'llm') {
    return `LLM means Gemini adjudicated an ambiguous boundary. Confidence ${formatScore(decision.confidence)} is the selected boundary decision score after model judgment.`;
  }

  if (decision.decisionMode === 'fallback') {
    return `Fallback means the engine could not safely use Gemini and chose the safest available candidate instead.`;
  }

  return `Hybrid means the engine considered the case ambiguous enough to route through the semantic adjudication path.`;
}

function getSecondCandidate(decision: TaskDecisionView) {
  return decision.candidateShortlist[1] ?? null;
}

function formatCandidateShortlist(decision: TaskDecisionView): string {
  if (decision.candidateShortlist.length === 0) {
    return 'No candidate shortlist recorded.';
  }

  return decision.candidateShortlist
    .slice(0, 4)
    .map(candidate => `${candidate.decision} ${formatScore(candidate?.score)}`)
    .join(' · ');
}

function formatFeatureSnapshot(decision: TaskDecisionView): string {
  const features = decision.featureSnapshot;

  if (features == null) {
    return 'No feature snapshot recorded.';
  }

  const parts = [
    `semantic ${formatScore(features.semanticContinuityScore)}`,
    `summarySimilarity ${formatScore(features.summaryTokenSimilarity)}`,
    `titleSimilarity ${formatScore(features.titleTokenSimilarity)}`,
    `recentSummarySimilarity ${formatScore(features.recentObservationSummarySimilarity)}`,
    `recentHypothesisSimilarity ${formatScore(features.recentObservationHypothesisSimilarity)}`,
    `repoOverlap ${features.repoOverlap}`,
    `ticketOverlap ${features.ticketOverlap}`,
    `recentAppMatch ${features.recentAppMatch ? 'yes' : 'no'}`,
    `appSeenInSegment ${features.appSeenInCurrentSegment ? 'yes' : 'no'}`,
    `workflowHint ${features.workflowContinuityHint ? 'yes' : 'no'}`,
    `sameHypothesis ${features.sameTaskHypothesis ? 'yes' : 'no'}`,
    `withinInterrupt ${features.withinInterruptionTolerance ? 'yes' : 'no'}`,
  ];

  return parts.join(' · ');
}

function explainWhyGeminiWasSkipped(decision: TaskDecisionView): string | null {
  if (decision.decisionMode !== 'deterministic') {
    return null;
  }

  const secondCandidate = getSecondCandidate(decision);

  if (secondCandidate == null) {
    return 'Gemini was not called because there was no meaningful runner-up candidate to arbitrate against.';
  }

  const topScore = decision.confidence;
  const scoreGap =
    typeof secondCandidate?.score === 'number'
      ? topScore - secondCandidate.score
      : null;
  const inAmbiguityBand =
    topScore >= DEFAULT_TASK_ENGINE_POLICY.ambiguityBandLow &&
    topScore <= DEFAULT_TASK_ENGINE_POLICY.ambiguityBandHigh;

  if (!inAmbiguityBand) {
    return `Gemini was not called because the top deterministic score ${formatScore(topScore)} sat outside the ambiguity band (${DEFAULT_TASK_ENGINE_POLICY.ambiguityBandLow.toFixed(2)}-${DEFAULT_TASK_ENGINE_POLICY.ambiguityBandHigh.toFixed(2)}).`;
  }

  return `Gemini was not called because the top candidate beat the runner-up by ${formatScore(scoreGap)}, which was enough to keep the decision local.`;
}

function looksOverconfident(decision: TaskDecisionView): boolean {
  if (decision.decisionMode !== 'deterministic' || decision.confidence < 0.95) {
    return false;
  }

  const secondCandidate = getSecondCandidate(decision);
  const features = decision.featureSnapshot;

  return Boolean(
    (secondCandidate != null &&
      secondCandidate.score >= DEFAULT_TASK_ENGINE_POLICY.ambiguityBandLow) ||
      (features != null &&
        !features.recentAppMatch &&
        features.totalEntityOverlap === 0 &&
        features.sameTaskHypothesis),
  );
}

export function TaskDecisionList({
  decisions,
  observationsById,
  formatTimestamp,
  styles,
}: TaskDecisionListProps) {
  if (decisions.length === 0) {
    return <Text style={styles.emptyState}>No task decisions have been recorded yet.</Text>;
  }

  return (
    <View style={styles.fixtureList}>
      {decisions.map(decision => {
        const observation = observationsById[decision.observationId];
        const secondCandidate = getSecondCandidate(decision);

        return (
        <View key={decision.id} style={[styles.fixtureRow, styles.taskObservationRow]}>
          {observation?.capturePreviewDataUri != null ? (
            <Image
              source={{uri: observation.capturePreviewDataUri}}
              style={styles.taskObservationImage}
            />
          ) : null}
          <View style={styles.taskObservationBody}>
          {looksOverconfident(decision) ? (
            <View style={styles.warningBadge}>
              <Text style={styles.warningBadgeText}>Overconfident deterministic decision</Text>
            </View>
          ) : null}
          <Text style={styles.fixtureTitle}>{decision.decision}</Text>
          <Text style={styles.fixtureMeta}>
            {formatTimestamp(decision.occurredAt)}
          </Text>
          <Text style={styles.fixtureMeta}>
            {decision.reasonCodes.join(', ') || 'No reason codes'}
          </Text>
          <Text style={styles.fixtureMeta}>
            confidence {decision.confidence.toFixed(2)} · {decision.decisionMode}
            {decision.usedLlm ? ' · llm' : ''}
          </Text>
          {getSecondCandidate(decision) != null ? (
            <Text style={styles.fieldHelp}>
              Runner-up candidate: {secondCandidate?.decision ?? 'unknown'}{' '}
              {formatScore(secondCandidate?.score)}
            </Text>
          ) : null}
          <Text style={styles.fieldHelp}>{decision.reasonText}</Text>
          <Text style={styles.fieldHelp}>{describeDecisionMode(decision)}</Text>
          {explainWhyGeminiWasSkipped(decision) != null ? (
            <Text style={styles.fieldHelp}>{explainWhyGeminiWasSkipped(decision)}</Text>
          ) : null}
          <Text style={styles.fieldHelp}>
            Candidate shortlist: {formatCandidateShortlist(decision)}
          </Text>
          <Text style={styles.fieldHelp}>
            Feature snapshot: {formatFeatureSnapshot(decision)}
          </Text>
          {decision.errorReason != null ? (
            <Text style={styles.fieldHelp}>Error/fallback reason: {decision.errorReason}</Text>
          ) : null}
          {observation != null ? (
            <>
              <Text style={styles.fieldHelp}>
                Source observation: {observation.structured?.taskHypothesis ?? observation.structured?.summary ?? observation.text}
              </Text>
              <Text style={styles.fieldHelp}>
                Observed at: {formatTimestamp(observation.observedAt)}
              </Text>
            </>
          ) : null}
          </View>
        </View>
      )})}
    </View>
  );
}
