/**
 * spec-factory types
 *
 * Zod schemas matching nexus-agents execute_spec, query_trace,
 * and registry_import MCP tool contracts.
 */

import { z } from 'zod';

// ============================================================================
// execute_spec
// ============================================================================

export const ExecuteSpecInputSchema = z.object({
  spec: z.string().min(1).max(50_000),
  dryRun: z.boolean().optional(),
});

export type ExecuteSpecInput = z.infer<typeof ExecuteSpecInputSchema>;

export const DryRunResponseSchema = z.object({
  mode: z.literal('dry_run'),
  spec: z.unknown(),
  dag: z.unknown(),
});

export type DryRunResponse = z.infer<typeof DryRunResponseSchema>;

export const ExecutionResponseSchema = z.object({
  mode: z.literal('execute'),
  execution: z.unknown(),
  analysis: z.unknown().nullable(),
});

export type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

export const SpecResponseSchema = z.union([
  DryRunResponseSchema,
  ExecutionResponseSchema,
]);

export type SpecResponse = z.infer<typeof SpecResponseSchema>;

// ============================================================================
// query_trace
// ============================================================================

export const QueryTraceInputSchema = z.object({
  runId: z.string().min(1),
  eventType: z.string().optional(),
  limit: z.number().min(1).max(500).optional(),
});

export type QueryTraceInput = z.infer<typeof QueryTraceInputSchema>;

export const QueryTraceResponseSchema = z.object({
  runId: z.string(),
  events: z.array(z.record(z.unknown())),
  totalEvents: z.number(),
  truncated: z.boolean(),
  source: z.enum(['disk', 'not_found']),
});

export type QueryTraceResponse = z.infer<typeof QueryTraceResponseSchema>;

// ============================================================================
// registry_import
// ============================================================================

export const RegistryImportInputSchema = z.object({
  provider: z.enum(['anthropic', 'google', 'openai']),
  modelId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export type RegistryImportInput = z.infer<typeof RegistryImportInputSchema>;

export const QualityScoresSchema = z.object({
  reasoning: z.number(),
  codeGeneration: z.number(),
  speed: z.number(),
  cost: z.number(),
});

export const ModelEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  contextWindow: z.number(),
  outputModalities: z.array(z.string()),
  inputModalities: z.array(z.string()),
  toolCapabilities: z.array(z.string()),
  specialFeatures: z.array(z.string()),
  pricing: z.object({
    inputPer1M: z.number(),
    outputPer1M: z.number(),
  }),
  qualityScores: QualityScoresSchema,
  cliName: z.string(),
  cliModelName: z.string(),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const RegistryImportResponseSchema = z.object({
  dryRun: z.boolean(),
  entry: ModelEntrySchema,
  persisted: z.boolean(),
  warnings: z.array(z.string()),
});

export type RegistryImportResponse = z.infer<typeof RegistryImportResponseSchema>;

// ============================================================================
// Pipeline types
// ============================================================================

export interface FactoryConfig {
  /** Markdown spec to execute. */
  readonly spec: string;
  /** Run spec in dry-run mode. */
  readonly dryRun?: boolean;
  /** Run ID for trace query (if known). */
  readonly traceRunId?: string;
  /** Per-call timeout (ms) for remote tool calls. Omit to use the default. */
  readonly timeoutMs?: number;
  /** Model to import for registry validation. */
  readonly registryImport?: {
    readonly provider: RegistryImportInput['provider'];
    readonly modelId: string;
  };
}

export interface FactoryResult {
  readonly specResult: SpecResponse | null;
  readonly specError: string | null;
  readonly traceResult: QueryTraceResponse | null;
  readonly registryResult: RegistryImportResponse | null;
}
