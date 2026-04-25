export type WorklogLabel =
  | 'worked_on'
  | 'reviewed'
  | 'drafted'
  | 'likely_completed'
  | 'confirmed_completed';

export type WorklogSummaryProvenance = {
  supportedByObservationIds: string[];
  supportedByEvidenceIds: string[];
  keyArtifacts: string[];
  reasonCodes: string[];
};

export type WorklogTaskSummary = {
  headline: string;
  narrative: string;
  provenance: WorklogSummaryProvenance;
};

export type WorklogCalendarBlock = {
  id: string;
  lineageId: string;
  segmentIds: string[];
  startTime: string;
  endTime: string;
  label: WorklogLabel;
  confidence: number;
  title: string;
  summary: WorklogTaskSummary;
  apps: string[];
  repos: string[];
  tickets: string[];
  documents: string[];
  reasonCodes: string[];
  keyActivities?: string[];
  category?: string;
  people?: string[];
  urls?: string[];
  notes?: string;
  notesKey?: string;
  continuityLinkage: {
    resumedFromLineageId: string | null;
    resumedSegmentCount: number;
  };
  debug: {
    decisionModes: string[];
    decisionCount: number;
    retroAdjusted: boolean;
  };
};

export type WorklogDayView = {
  dateIso: string;
  timezone: string;
  generatedAt: string;
  blocks: WorklogCalendarBlock[];
  totals: {
    blockCount: number;
    focusedMinutes: number;
  };
};
