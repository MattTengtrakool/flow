import { sampleObservationIds } from './condenseObservations';
import {
  CATEGORY_VALUES,
  MAX_SOURCE_OBSERVATIONS_PER_BLOCK,
  WORKLOG_LABELS,
  type ParsedReplanBlock,
  type ReplanRawBlock,
} from './replanTypes';
import type { CondensedObservationEntry } from './types';

export function expandClusterIds(
  blocks: ParsedReplanBlock[],
  clusters: CondensedObservationEntry[],
): ReplanRawBlock[] {
  const clustersById = new Map<string, CondensedObservationEntry>();
  for (const cluster of clusters) {
    clustersById.set(cluster.clusterId, cluster);
  }

  return blocks.map(block => {
    const observationIds = new Set<string>();
    for (const clusterId of block.sourceClusterIds) {
      const cluster = clustersById.get(clusterId);
      if (cluster == null) continue;
      for (const observationId of cluster.sourceObservationIds) {
        observationIds.add(observationId);
      }
    }

    const { sourceClusterIds, ...rest } = block;
    void sourceClusterIds;

    return {
      ...rest,
      sourceObservationIds: sampleObservationIds(
        Array.from(observationIds),
        MAX_SOURCE_OBSERVATIONS_PER_BLOCK,
      ),
    };
  });
}

export function parseReplanResponseSafely(
  rawText: string,
  finishReason: string | undefined,
): ParsedReplanBlock[] {
  const trimmed = rawText.trim();

  const firstAttempt = tryParse(trimmed);
  if (firstAttempt != null) {
    return coerceBlocks(firstAttempt, rawText, finishReason);
  }

  const recovered = tryRecoverTruncatedJson(trimmed);
  if (recovered != null) {
    const recoveredParsed = tryParse(recovered);
    if (recoveredParsed != null) {
      return coerceBlocks(recoveredParsed, rawText, finishReason);
    }
  }

  const preview = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  const prefix =
    finishReason === 'MAX_TOKENS'
      ? 'The model hit the output token ceiling before finishing the JSON. Try fewer observations or a shorter window.'
      : finishReason === 'SAFETY'
      ? 'The model refused to generate output due to safety filters.'
      : `Could not parse the model's JSON`;
  throw new Error(
    `${prefix}${
      finishReason && finishReason !== 'STOP'
        ? ` (finishReason: ${finishReason})`
        : ''
    }. Preview: ${preview.length > 0 ? preview : '(empty response)'}`,
  );
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryRecoverTruncatedJson(text: string): string | null {
  const blocksStart = text.indexOf('"blocks"');
  if (blocksStart === -1) return null;
  const arrayStart = text.indexOf('[', blocksStart);
  if (arrayStart === -1) return null;

  let depth = 0;
  let lastCompleteBlockEnd = -1;
  let inString = false;
  let escape = false;
  for (let i = arrayStart; i < text.length; i += 1) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        lastCompleteBlockEnd = i;
      }
    }
  }

  if (lastCompleteBlockEnd === -1) return null;
  const truncated = text.slice(0, lastCompleteBlockEnd + 1);
  const cleaned = truncated.replace(/,\s*$/, '');
  return `${cleaned}]}`;
}

export function coerceBlocks(
  parsed: unknown,
  rawText: string,
  finishReason: string | undefined,
): ParsedReplanBlock[] {
  if (typeof parsed !== 'object' || parsed == null) {
    throw new Error(
      `Replan JSON did not return an object${
        finishReason ? ` (finishReason: ${finishReason})` : ''
      }. Got: ${typeof parsed}`,
    );
  }

  const blocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    const preview =
      rawText.length > 160 ? `${rawText.slice(0, 160)}…` : rawText;
    throw new Error(
      `Replan JSON did not contain a blocks array. Preview: ${preview}`,
    );
  }

  return blocks.map((value, index) => coerceBlock(value, index));
}

function coerceBlock(value: unknown, index: number): ParsedReplanBlock {
  if (typeof value !== 'object' || value == null) {
    throw new Error(`Replan block ${index} was not an object.`);
  }
  const candidate = value as Record<string, unknown>;

  const startAt = requireString(candidate.startAt, `blocks[${index}].startAt`);
  const endAt = requireString(candidate.endAt, `blocks[${index}].endAt`);
  const headline = requireString(
    candidate.headline,
    `blocks[${index}].headline`,
  );
  const narrative = requireString(
    candidate.narrative,
    `blocks[${index}].narrative`,
  );
  const notes = typeof candidate.notes === 'string' ? candidate.notes : '';
  const label = requireEnum(
    candidate.label,
    WORKLOG_LABELS,
    `blocks[${index}].label`,
  );
  const category = requireString(candidate.category, `blocks[${index}].category`);
  const confidence = requireNumber(
    candidate.confidence,
    `blocks[${index}].confidence`,
  );
  const keyActivities = requireStringArray(
    candidate.keyActivities,
    `blocks[${index}].keyActivities`,
  );
  const nextActions = toStringArray(candidate.nextActions);
  const calendarEventIds = toStringArray(candidate.calendarEventIds);
  const reasonCodes = requireStringArray(
    candidate.reasonCodes,
    `blocks[${index}].reasonCodes`,
  );
  const sourceClusterIds = toStringArray(candidate.sourceClusterIds);
  const backgroundObservationIds = toStringArray(candidate.backgroundObservationIds);
  const assignmentReason =
    typeof candidate.assignmentReason === 'string'
      ? candidate.assignmentReason
      : '';
  const timeConfidence =
    typeof candidate.timeConfidence === 'number' &&
    Number.isFinite(candidate.timeConfidence)
      ? candidate.timeConfidence
      : undefined;
  const artifacts = coerceArtifacts(candidate.artifacts, index);

  return {
    taskKey: typeof candidate.taskKey === 'string' ? candidate.taskKey : '',
    lineageKey:
      typeof candidate.lineageKey === 'string' ? candidate.lineageKey : '',
    startAt,
    endAt,
    headline,
    narrative,
    notes,
    label,
    category,
    confidence,
    keyActivities,
    nextActions,
    calendarEventIds,
    reasonCodes,
    backgroundObservationIds,
    assignmentReason,
    timeConfidence,
    sourceClusterIds,
    artifacts,
  };
}

function coerceArtifacts(
  value: unknown,
  index: number,
): ParsedReplanBlock['artifacts'] {
  if (typeof value !== 'object' || value == null) {
    throw new Error(`blocks[${index}].artifacts was not an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    apps: toStringArray(record.apps),
    projects: toStringArray(record.projects),
    tasks: toStringArray(record.tasks),
    repositories: toStringArray(record.repositories),
    urls: toStringArray(record.urls),
    tickets: toStringArray(record.tickets),
    documents: toStringArray(record.documents),
    people: toStringArray(record.people),
  };
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} was missing or not a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} was not a finite number.`);
  }
  return value;
}

function requireEnum<Options extends readonly string[]>(
  value: unknown,
  options: Options,
  path: string,
): Options[number] {
  if (
    typeof value !== 'string' ||
    !options.includes(value as Options[number])
  ) {
    throw new Error(
      `${path} must be one of: ${options.join(', ')}. Got: ${String(value)}`,
    );
  }
  return value as Options[number];
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${path} must be an array of strings.`);
  }
  return value as string[];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}
