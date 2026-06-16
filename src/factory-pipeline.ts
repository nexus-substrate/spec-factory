/**
 * Factory pipeline
 *
 * Chains execute_spec → query_trace → registry_import
 * to validate the full AI software factory workflow.
 */

import type {
  FactoryConfig,
  FactoryResult,
  SpecResponse,
  QueryTraceResponse,
  RegistryImportResponse,
} from './types.js';
import {
  SpecResponseSchema,
  QueryTraceResponseSchema,
  RegistryImportResponseSchema,
} from './types.js';

// ============================================================================
// Tool caller abstraction
// ============================================================================

export interface ToolCaller {
  call(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Default per-call timeout for remote tool calls (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Error thrown when a tool call exceeds its configured timeout. */
export class ToolCallTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool call '${toolName}' timed out after ${timeoutMs}ms`);
    this.name = 'ToolCallTimeoutError';
  }
}

/**
 * Wrap a ToolCaller so every call is bounded by `timeoutMs`.
 *
 * Uses an AbortController combined with a timer, guaranteeing the returned
 * promise settles even if the underlying call hangs forever.
 */
export function withTimeout(
  caller: ToolCaller,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): ToolCaller {
  return {
    call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      const controller = new AbortController();
      const callArgs = { ...args, signal: controller.signal };
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          controller.abort();
          reject(new ToolCallTimeoutError(toolName, timeoutMs));
        }, timeoutMs);
        caller.call(toolName, callArgs).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    },
  };
}

// ============================================================================
// Individual steps
// ============================================================================

/** Step 1: Execute a spec through the pipeline. */
export async function executeSpec(
  caller: ToolCaller,
  spec: string,
  dryRun: boolean
): Promise<SpecResponse> {
  const raw = await caller.call('execute_spec', { spec, dryRun });
  return SpecResponseSchema.parse(raw);
}

/** Step 2: Query execution traces for a run. */
export async function queryTrace(
  caller: ToolCaller,
  runId: string,
  eventType?: string,
  limit?: number
): Promise<QueryTraceResponse> {
  const args: Record<string, unknown> = { runId };
  if (eventType !== undefined) args['eventType'] = eventType;
  if (limit !== undefined) args['limit'] = limit;

  const raw = await caller.call('query_trace', args);
  return QueryTraceResponseSchema.parse(raw);
}

/** Step 3: Import a model to the registry (dry-run). */
export async function importModel(
  caller: ToolCaller,
  provider: string,
  modelId: string
): Promise<RegistryImportResponse> {
  const raw = await caller.call('registry_import', {
    provider,
    modelId,
    dryRun: true,
  });
  return RegistryImportResponseSchema.parse(raw);
}

// ============================================================================
// Full pipeline
// ============================================================================

/** Run the complete factory pipeline. */
export async function runFactoryPipeline(
  caller: ToolCaller,
  config: FactoryConfig
): Promise<FactoryResult> {
  const boundedCaller = withTimeout(caller, config.timeoutMs);

  // Step 1: Execute spec
  let specResult: SpecResponse | null = null;
  let specError: string | null = null;
  try {
    specResult = await executeSpec(
      boundedCaller,
      config.spec,
      config.dryRun ?? true
    );
  } catch (err) {
    specError = err instanceof Error ? err.message : String(err);
  }

  // Step 2: Query traces (if run ID available)
  let traceResult: QueryTraceResponse | null = null;
  if (config.traceRunId !== undefined) {
    traceResult = await queryTrace(boundedCaller, config.traceRunId);
  }

  // Step 3: Registry import (if configured)
  let registryResult: RegistryImportResponse | null = null;
  if (config.registryImport !== undefined) {
    registryResult = await importModel(
      boundedCaller,
      config.registryImport.provider,
      config.registryImport.modelId
    );
  }

  return { specResult, specError, traceResult, registryResult };
}

// ============================================================================
// Spec builders
// ============================================================================

/** Build a minimal valid spec for testing. */
export function buildTestSpec(title: string, task: string): string {
  return [
    `# ${title}`,
    '',
    '## Requirements',
    `- ${task}`,
    '',
    '## Acceptance Criteria',
    `- Task "${task}" is completed`,
  ].join('\n');
}
