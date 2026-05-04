'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CASES_DIR = path.join('benchmarks', 'cases');
const MATCH_IOU_THRESHOLD = 0.1;

function main(argv) {
  const options = parseArgs(argv);
  const report = runPlannerBenchmark(options.casesDir);
  if (options.outPath != null) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
}

function parseArgs(argv) {
  let casesDir = DEFAULT_CASES_DIR;
  let json = false;
  let outPath = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--cases') {
      casesDir = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--out') {
      outPath = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith('--')) {
      casesDir = arg;
    } else {
      throw new Error(`Unknown benchmark option: ${arg}`);
    }
  }

  return {
    casesDir: path.resolve(casesDir),
    json,
    outPath: outPath != null ? path.resolve(outPath) : null,
  };
}

function runPlannerBenchmark(casesDir) {
  const cases = loadCases(casesDir);
  if (cases.length === 0) {
    throw new Error(`No benchmark cases found in ${casesDir}`);
  }

  const caseReports = cases.map(evaluateCase);
  const totals = emptyTotals();
  for (const report of caseReports) {
    totals.caseCount += 1;
    totals.goldBlockCount += report.goldBlockCount;
    totals.predictedBlockCount += report.predictedBlockCount;
    totals.matchedBlockCount += report.matchedBlockCount;
    totals.categoryCorrect += report.categoryCorrect;
    totals.overMergedBlocks += report.overMergedBlocks;
    totals.overSplitBlocks += report.overSplitBlocks;
    totals.headlineAnchorPassCount += report.headlineAnchorPassCount;
    totals.temporalIouSum += report.temporalIouSum;
    totals.artifactF1Sum += report.artifactF1Sum;
    totals.startBoundaryErrorMinutesSum += report.startBoundaryErrorMinutesSum;
    totals.endBoundaryErrorMinutesSum += report.endBoundaryErrorMinutesSum;
  }

  return {
    generatedAt: new Date().toISOString(),
    casesDir,
    summary: summarizeTotals(totals),
    cases: caseReports.map(stripInternalSums),
  };
}

function loadCases(casesDir) {
  if (!fs.existsSync(casesDir)) return [];
  return fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const caseDir = path.join(casesDir, entry.name);
      const gold = readJson(path.join(caseDir, 'gold.json'));
      const predictionPath = path.join(caseDir, 'predicted-plan.json');
      const eventLogPath = path.join(caseDir, 'event-log.json');
      const predictedBlocks = fs.existsSync(predictionPath)
        ? readPredictedPlan(predictionPath)
        : readPredictedBlocksFromEventLog(eventLogPath);
      return {
        id: entry.name,
        name: gold.name ?? entry.name,
        description: gold.description ?? '',
        goldBlocks: normalizeGoldBlocks(gold.blocks ?? []),
        predictedBlocks: normalizePredictedBlocks(predictedBlocks),
      };
    });
}

function readPredictedPlan(filePath) {
  const payload = readJson(filePath);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.blocks)) return payload.blocks;
  throw new Error(`${filePath} must be a plan snapshot or block array.`);
}

function readPredictedBlocksFromEventLog(filePath) {
  const events = readJson(filePath);
  if (!Array.isArray(events)) {
    throw new Error(`${filePath} must contain a DomainEvent array.`);
  }
  const planEvents = events.filter(
    event => event?.type === 'task_plan_revised' && event.snapshot != null,
  );
  const latest = planEvents[planEvents.length - 1];
  if (latest == null) {
    throw new Error(`${filePath} does not contain a task_plan_revised event.`);
  }
  return latest.snapshot.blocks ?? [];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeGoldBlocks(blocks) {
  return blocks.map((block, index) => ({
    id: String(block.id ?? `gold_${index}`),
    startAt: requireString(block.startAt, `gold.blocks[${index}].startAt`),
    endAt: requireString(block.endAt, `gold.blocks[${index}].endAt`),
    headline: String(block.headline ?? block.task ?? block.title ?? ''),
    category: String(block.category ?? 'other'),
    artifacts: normalizeArtifacts(block.artifacts ?? block),
  }));
}

function normalizePredictedBlocks(blocks) {
  return blocks.map((block, index) => ({
    id: String(block.id ?? `predicted_${index}`),
    startAt: requireString(block.startAt, `predicted.blocks[${index}].startAt`),
    endAt: requireString(block.endAt, `predicted.blocks[${index}].endAt`),
    headline: String(block.headline ?? block.title ?? ''),
    category: String(block.category ?? 'other'),
    confidence:
      typeof block.confidence === 'number' && Number.isFinite(block.confidence)
        ? block.confidence
        : null,
    artifacts: normalizeArtifacts(block.artifacts ?? block),
  }));
}

function normalizeArtifacts(value) {
  return {
    apps: stringArray(value.apps),
    repositories: stringArray(value.repositories ?? value.repos),
    urls: stringArray(value.urls),
    tickets: stringArray(value.tickets),
    documents: stringArray(value.documents),
    people: stringArray(value.people),
  };
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function requireString(value, pathLabel) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${pathLabel} is required.`);
  }
  return value;
}

function evaluateCase(testCase) {
  const matches = matchBlocks(testCase.goldBlocks, testCase.predictedBlocks);
  const matchedGoldIds = new Set(matches.map(match => match.gold.id));
  const matchedPredictedIds = new Set(matches.map(match => match.predicted.id));
  const unmatchedGold = testCase.goldBlocks
    .filter(block => !matchedGoldIds.has(block.id))
    .map(block => block.id);
  const unmatchedPredicted = testCase.predictedBlocks
    .filter(block => !matchedPredictedIds.has(block.id))
    .map(block => block.id);

  let categoryCorrect = 0;
  let headlineAnchorPassCount = 0;
  let temporalIouSum = 0;
  let artifactF1Sum = 0;
  let startBoundaryErrorMinutesSum = 0;
  let endBoundaryErrorMinutesSum = 0;

  for (const match of matches) {
    if (
      normalizeText(match.predicted.category) ===
      normalizeText(match.gold.category)
    ) {
      categoryCorrect += 1;
    }
    if (headlineAnchorPasses(match.predicted, match.gold)) {
      headlineAnchorPassCount += 1;
    }
    temporalIouSum += match.temporalIou;
    artifactF1Sum += artifactF1(match.predicted, match.gold);
    startBoundaryErrorMinutesSum += boundaryErrorMinutes(
      match.predicted.startAt,
      match.gold.startAt,
    );
    endBoundaryErrorMinutesSum += boundaryErrorMinutes(
      match.predicted.endAt,
      match.gold.endAt,
    );
  }

  const overSplitBlocks = countOverSplits(
    testCase.goldBlocks,
    testCase.predictedBlocks,
  );
  const overMergedBlocks = countOverMerges(
    testCase.goldBlocks,
    testCase.predictedBlocks,
  );

  const totals = {
    caseCount: 1,
    goldBlockCount: testCase.goldBlocks.length,
    predictedBlockCount: testCase.predictedBlocks.length,
    matchedBlockCount: matches.length,
    categoryCorrect,
    overMergedBlocks,
    overSplitBlocks,
    headlineAnchorPassCount,
    temporalIouSum,
    artifactF1Sum,
    startBoundaryErrorMinutesSum,
    endBoundaryErrorMinutesSum,
  };

  return {
    id: testCase.id,
    name: testCase.name,
    description: testCase.description,
    ...totals,
    ...summarizeTotals(totals),
    unmatchedGold,
    unmatchedPredicted,
  };
}

function matchBlocks(goldBlocks, predictedBlocks) {
  const pairs = [];
  for (const gold of goldBlocks) {
    for (const predicted of predictedBlocks) {
      const temporalIou = intervalIou(gold, predicted);
      if (temporalIou >= MATCH_IOU_THRESHOLD) {
        pairs.push({ gold, predicted, temporalIou });
      }
    }
  }

  pairs.sort((left, right) => right.temporalIou - left.temporalIou);

  const usedGold = new Set();
  const usedPredicted = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (usedGold.has(pair.gold.id) || usedPredicted.has(pair.predicted.id)) {
      continue;
    }
    usedGold.add(pair.gold.id);
    usedPredicted.add(pair.predicted.id);
    matches.push(pair);
  }
  return matches;
}

function intervalIou(left, right) {
  const leftStart = Date.parse(left.startAt);
  const leftEnd = Date.parse(left.endAt);
  const rightStart = Date.parse(right.startAt);
  const rightEnd = Date.parse(right.endAt);
  if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) {
    return 0;
  }
  const intersection = Math.max(
    0,
    Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
  );
  const union = Math.max(leftEnd, rightEnd) - Math.min(leftStart, rightStart);
  return union > 0 ? intersection / union : 0;
}

function artifactF1(predicted, gold) {
  const predictedSet = flattenArtifacts(predicted.artifacts);
  const goldSet = flattenArtifacts(gold.artifacts);
  if (predictedSet.size === 0 && goldSet.size === 0) return 1;
  if (predictedSet.size === 0 || goldSet.size === 0) return 0;

  let truePositive = 0;
  for (const value of predictedSet) {
    if (goldSet.has(value)) truePositive += 1;
  }
  const precision = truePositive / predictedSet.size;
  const recall = truePositive / goldSet.size;
  return precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;
}

function flattenArtifacts(artifacts) {
  const values = [
    ...artifacts.apps,
    ...artifacts.repositories,
    ...artifacts.urls,
    ...artifacts.tickets,
    ...artifacts.documents,
    ...artifacts.people,
  ];
  return new Set(values.map(normalizeArtifact).filter(Boolean));
}

function normalizeArtifact(value) {
  return normalizeText(value)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

function headlineAnchorPasses(predicted, gold) {
  const headline = normalizeText(predicted.headline);
  const goldHeadline = normalizeText(gold.headline);
  const anchors = [
    ...gold.artifacts.tickets,
    ...gold.artifacts.repositories,
    ...gold.artifacts.documents.map(document => path.basename(document)),
    ...gold.artifacts.people,
  ]
    .map(normalizeText)
    .filter(value => value.length >= 3);

  if (anchors.some(anchor => headline.includes(anchor))) return true;
  return tokenOverlap(headline, goldHeadline) >= 0.5;
}

function tokenOverlap(left, right) {
  const leftTokens = contentTokens(left);
  const rightTokens = contentTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function contentTokens(text) {
  const stop = new Set(['the', 'and', 'for', 'with', 'work', 'task', 'flow']);
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9-]+/i)
      .filter(token => token.length > 2 && !stop.has(token)),
  );
}

function countOverSplits(goldBlocks, predictedBlocks) {
  return goldBlocks.reduce((count, gold) => {
    const overlappingPredictions = predictedBlocks.filter(
      predicted => intervalIou(gold, predicted) >= MATCH_IOU_THRESHOLD,
    ).length;
    return count + Math.max(0, overlappingPredictions - 1);
  }, 0);
}

function countOverMerges(goldBlocks, predictedBlocks) {
  return predictedBlocks.reduce((count, predicted) => {
    const overlappingGold = goldBlocks.filter(
      gold => intervalIou(gold, predicted) >= MATCH_IOU_THRESHOLD,
    ).length;
    return count + Math.max(0, overlappingGold - 1);
  }, 0);
}

function boundaryErrorMinutes(predictedIso, goldIso) {
  return Math.abs(Date.parse(predictedIso) - Date.parse(goldIso)) / 60_000;
}

function normalizeText(value) {
  return String(value).trim().toLowerCase();
}

function emptyTotals() {
  return {
    caseCount: 0,
    goldBlockCount: 0,
    predictedBlockCount: 0,
    matchedBlockCount: 0,
    categoryCorrect: 0,
    overMergedBlocks: 0,
    overSplitBlocks: 0,
    headlineAnchorPassCount: 0,
    temporalIouSum: 0,
    artifactF1Sum: 0,
    startBoundaryErrorMinutesSum: 0,
    endBoundaryErrorMinutesSum: 0,
  };
}

function summarizeTotals(totals) {
  const blockPrecision = safeDivide(
    totals.matchedBlockCount,
    totals.predictedBlockCount,
  );
  const blockRecall = safeDivide(
    totals.matchedBlockCount,
    totals.goldBlockCount,
  );
  return {
    caseCount: totals.caseCount,
    goldBlockCount: totals.goldBlockCount,
    predictedBlockCount: totals.predictedBlockCount,
    matchedBlockCount: totals.matchedBlockCount,
    blockPrecision,
    blockRecall,
    blockF1:
      blockPrecision + blockRecall > 0
        ? (2 * blockPrecision * blockRecall) / (blockPrecision + blockRecall)
        : 0,
    temporalIoU: safeDivide(totals.temporalIouSum, totals.matchedBlockCount),
    categoryAccuracy: safeDivide(
      totals.categoryCorrect,
      totals.matchedBlockCount,
    ),
    artifactF1: safeDivide(totals.artifactF1Sum, totals.matchedBlockCount),
    headlineAnchorPassRate: safeDivide(
      totals.headlineAnchorPassCount,
      totals.matchedBlockCount,
    ),
    meanStartBoundaryErrorMinutes: safeDivide(
      totals.startBoundaryErrorMinutesSum,
      totals.matchedBlockCount,
    ),
    meanEndBoundaryErrorMinutes: safeDivide(
      totals.endBoundaryErrorMinutesSum,
      totals.matchedBlockCount,
    ),
    overMergedBlocks: totals.overMergedBlocks,
    overSplitBlocks: totals.overSplitBlocks,
  };
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function stripInternalSums(report) {
  const {
    categoryCorrect,
    headlineAnchorPassCount,
    temporalIouSum,
    artifactF1Sum,
    startBoundaryErrorMinutesSum,
    endBoundaryErrorMinutesSum,
    ...publicReport
  } = report;
  return publicReport;
}

function formatReport(report) {
  const lines = [];
  const summary = report.summary;
  lines.push('Planner benchmark');
  lines.push('');
  lines.push(`Cases: ${summary.caseCount}`);
  lines.push(`Gold blocks: ${summary.goldBlockCount}`);
  lines.push(`Predicted blocks: ${summary.predictedBlockCount}`);
  lines.push(`Matched blocks: ${summary.matchedBlockCount}`);
  lines.push(`Block precision: ${formatPercent(summary.blockPrecision)}`);
  lines.push(`Block recall: ${formatPercent(summary.blockRecall)}`);
  lines.push(`Block F1: ${formatPercent(summary.blockF1)}`);
  lines.push(`Temporal IoU: ${formatDecimal(summary.temporalIoU)}`);
  lines.push(`Category accuracy: ${formatPercent(summary.categoryAccuracy)}`);
  lines.push(`Artifact F1: ${formatPercent(summary.artifactF1)}`);
  lines.push(
    `Headline anchor pass rate: ${formatPercent(
      summary.headlineAnchorPassRate,
    )}`,
  );
  lines.push(
    `Boundary error: start ${formatDecimal(
      summary.meanStartBoundaryErrorMinutes,
    )} min, end ${formatDecimal(summary.meanEndBoundaryErrorMinutes)} min`,
  );
  lines.push(`Over-merged blocks: ${summary.overMergedBlocks}`);
  lines.push(`Over-split blocks: ${summary.overSplitBlocks}`);
  lines.push('');
  lines.push('Cases');
  for (const testCase of report.cases) {
    lines.push(
      `- ${testCase.name}: F1 ${formatPercent(
        testCase.blockF1,
      )}, IoU ${formatDecimal(testCase.temporalIoU)}, category ${formatPercent(
        testCase.categoryAccuracy,
      )}, artifacts ${formatPercent(testCase.artifactF1)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDecimal(value) {
  return value.toFixed(2);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

module.exports = {
  artifactF1,
  evaluateCase,
  formatReport,
  intervalIou,
  matchBlocks,
  runPlannerBenchmark,
};
