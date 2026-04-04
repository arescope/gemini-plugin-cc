// scripts/lib/types.d.ts
// TypeScript type definitions for gemini-plugin-cc lib interfaces

export type JobStatus = "running" | "done" | "error" | "cancelled";
export type JobClass = "review" | "challenge" | "analyze" | "task";

export interface Job {
  id: string;
  class: JobClass;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  sessionId?: string | null;
  pid?: number;
  prompt?: string | null;
  model?: string | null;
  effort?: string | null;
  write?: boolean;
  lastMessage?: string;
  updatedAt?: string;
  error?: string;
}

export interface JobRecord extends Job {
  result?: unknown;
}

export type ReviewTargetMode = "working-tree" | "branch";

export interface ReviewTarget {
  mode: ReviewTargetMode;
  baseRef?: string;
  label: string;
}

export interface ReviewContext {
  repoRoot: string;
  branch: string;
  target: ReviewTarget;
  summary: string;
  content: string;
}

export interface Finding {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  file: string;
  line_start: number;
  line_end: number;
  confidence: number;
  recommendation: string;
}

export interface ReviewOutput {
  verdict: "approve" | "needs-attention";
  summary: string;
  findings: Finding[];
  next_steps: string[];
}

export interface ParsedStructuredOutput {
  parsed: ReviewOutput | null;
  parseError: string | null;
  rawOutput: string;
}

export interface GeminiRunOptions {
  prompt?: string;
  model?: string;
  effort?: string;
  write?: boolean;
  allFiles?: boolean;
  dirs?: string;
  files?: string;
  plan?: boolean;
  resumeLatest?: boolean;
  outputFormat?: "text" | "json";
}

export interface GeminiRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface Config {
  stopReviewGate?: boolean;
  [key: string]: unknown;
}

export interface StateFile {
  jobs: Job[];
  config: Config;
}

export interface SetupReport {
  geminiAvailable: boolean;
  geminiVersion?: string | null;
  loggedIn: boolean;
  detail?: string | null;
  reviewGateEnabled: boolean;
}

export interface StatusReport {
  jobs: Job[];
}

export interface ProgressReporter {
  (message: string): void;
}

export interface PromptVariables {
  [key: string]: string | undefined;
}
