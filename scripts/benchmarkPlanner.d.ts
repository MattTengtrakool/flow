type BenchmarkBlock = {
  startAt?: string;
  endAt?: string;
  headline?: string;
  category?: string;
  artifacts?: {
    apps?: string[];
    repositories?: string[];
    repos?: string[];
    urls?: string[];
    tickets?: string[];
    documents?: string[];
    people?: string[];
  };
};

export function artifactF1(
  predicted: BenchmarkBlock,
  gold: BenchmarkBlock,
): number;

export function intervalIou(
  left: BenchmarkBlock,
  right: BenchmarkBlock,
): number;

export function runPlannerBenchmark(casesDir: string): {
  summary: {
    caseCount: number;
    blockF1: number;
  };
  cases: Array<{
    id: string;
  }>;
};
