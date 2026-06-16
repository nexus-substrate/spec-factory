/**
 * Factory pipeline tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCaller } from './factory-pipeline.js';
import {
  executeSpec,
  queryTrace,
  importModel,
  runFactoryPipeline,
  buildTestSpec,
  withTimeout,
  ToolCallTimeoutError,
} from './factory-pipeline.js';
import type { FactoryConfig } from './types.js';
import {
  MOCK_DRY_RUN_RESPONSE,
  MOCK_EXECUTION_RESPONSE,
  MOCK_EXECUTION_WITH_FAILURES,
  MOCK_TRACE_RESPONSE,
  MOCK_TRACE_NOT_FOUND,
  MOCK_TRACE_FILTERED,
  MOCK_REGISTRY_IMPORT_RESPONSE,
} from './fixtures/mock-responses.js';

function createMockCaller(
  responses: Record<string, unknown>
): ToolCaller & { calls: Array<{ tool: string; args: Record<string, unknown> }> } {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    call: vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      calls.push({ tool: toolName, args });
      const response = responses[toolName];
      if (response === undefined) throw new Error(`No mock: ${toolName}`);
      return response;
    }),
  };
}

// ============================================================================
// executeSpec
// ============================================================================

describe('executeSpec', () => {
  it('calls execute_spec with dry_run mode', async () => {
    const caller = createMockCaller({
      execute_spec: MOCK_DRY_RUN_RESPONSE,
    });

    const result = await executeSpec(caller, '# Test\n## Requirements\n- Do thing', true);

    expect(caller.calls[0]?.tool).toBe('execute_spec');
    expect(caller.calls[0]?.args).toEqual({
      spec: '# Test\n## Requirements\n- Do thing',
      dryRun: true,
    });
    expect(result.mode).toBe('dry_run');
  });

  it('validates dry_run response shape', async () => {
    const caller = createMockCaller({
      execute_spec: MOCK_DRY_RUN_RESPONSE,
    });

    const result = await executeSpec(caller, 'spec', true);

    expect(result.mode).toBe('dry_run');
    if (result.mode === 'dry_run') {
      expect(result.spec).toBeDefined();
      expect(result.dag).toBeDefined();
    }
  });

  it('validates execution response shape', async () => {
    const caller = createMockCaller({
      execute_spec: MOCK_EXECUTION_RESPONSE,
    });

    const result = await executeSpec(caller, 'spec', false);

    expect(result.mode).toBe('execute');
    if (result.mode === 'execute') {
      expect(result.execution).toBeDefined();
    }
  });

  it('handles execution with failures', async () => {
    const caller = createMockCaller({
      execute_spec: MOCK_EXECUTION_WITH_FAILURES,
    });

    const result = await executeSpec(caller, 'spec', false);

    expect(result.mode).toBe('execute');
    if (result.mode === 'execute') {
      expect(result.analysis).not.toBeNull();
    }
  });

  it('rejects invalid response', async () => {
    const caller = createMockCaller({
      execute_spec: { invalid: true },
    });

    await expect(executeSpec(caller, 'spec', true)).rejects.toThrow();
  });

  it('propagates tool errors', async () => {
    const caller: ToolCaller = {
      call: vi.fn(async () => {
        throw new Error('Decompose error: no requirements');
      }),
    };

    await expect(executeSpec(caller, 'bad spec', true)).rejects.toThrow(
      'Decompose error'
    );
  });
});

// ============================================================================
// queryTrace
// ============================================================================

describe('queryTrace', () => {
  it('queries trace by run ID', async () => {
    const caller = createMockCaller({
      query_trace: MOCK_TRACE_RESPONSE,
    });

    const result = await queryTrace(caller, 'run-abc-123');

    expect(caller.calls[0]?.args).toEqual({ runId: 'run-abc-123' });
    expect(result.events).toHaveLength(3);
    expect(result.source).toBe('disk');
    expect(result.truncated).toBe(false);
  });

  it('handles not-found traces', async () => {
    const caller = createMockCaller({
      query_trace: MOCK_TRACE_NOT_FOUND,
    });

    const result = await queryTrace(caller, 'nonexistent');

    expect(result.events).toHaveLength(0);
    expect(result.source).toBe('not_found');
  });

  it('passes event type filter', async () => {
    const caller = createMockCaller({
      query_trace: MOCK_TRACE_FILTERED,
    });

    const result = await queryTrace(caller, 'run-abc-123', 'model.called');

    expect(caller.calls[0]?.args).toEqual({
      runId: 'run-abc-123',
      eventType: 'model.called',
    });
    expect(result.events).toHaveLength(1);
  });

  it('passes limit', async () => {
    const caller = createMockCaller({
      query_trace: MOCK_TRACE_RESPONSE,
    });

    await queryTrace(caller, 'run-abc-123', undefined, 50);

    expect(caller.calls[0]?.args).toEqual({
      runId: 'run-abc-123',
      limit: 50,
    });
  });

  it('validates trace event structure', async () => {
    const caller = createMockCaller({
      query_trace: MOCK_TRACE_RESPONSE,
    });

    const result = await queryTrace(caller, 'run-abc-123');

    const event = result.events[0];
    expect(event).toBeDefined();
    expect(event!['eventType']).toBe('task.started');
  });
});

// ============================================================================
// importModel
// ============================================================================

describe('importModel', () => {
  it('imports model with dry run', async () => {
    const caller = createMockCaller({
      registry_import: MOCK_REGISTRY_IMPORT_RESPONSE,
    });

    const result = await importModel(caller, 'anthropic', 'claude-test-model');

    expect(caller.calls[0]?.args).toEqual({
      provider: 'anthropic',
      modelId: 'claude-test-model',
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.persisted).toBe(false);
  });

  it('validates model entry shape', async () => {
    const caller = createMockCaller({
      registry_import: MOCK_REGISTRY_IMPORT_RESPONSE,
    });

    const result = await importModel(caller, 'anthropic', 'test');

    expect(result.entry.id).toBe('claude-test-model');
    expect(result.entry.provider).toBe('anthropic');
    expect(result.entry.qualityScores.reasoning).toBe(5);
    expect(result.entry.contextWindow).toBeGreaterThan(0);
  });

  it('returns warnings for human review', async () => {
    const caller = createMockCaller({
      registry_import: MOCK_REGISTRY_IMPORT_RESPONSE,
    });

    const result = await importModel(caller, 'anthropic', 'test');

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('human review');
  });

  it('validates pricing structure', async () => {
    const caller = createMockCaller({
      registry_import: MOCK_REGISTRY_IMPORT_RESPONSE,
    });

    const result = await importModel(caller, 'anthropic', 'test');

    expect(result.entry.pricing.inputPer1M).toBe(0);
    expect(result.entry.pricing.outputPer1M).toBe(0);
  });
});

// ============================================================================
// buildTestSpec
// ============================================================================

describe('withTimeout', () => {
  it('rejects with ToolCallTimeoutError when the call hangs', async () => {
    const caller: ToolCaller = {
      call: vi.fn(() => new Promise<unknown>(() => {})),
    };

    const bounded = withTimeout(caller, 10);

    await expect(bounded.call('execute_spec', {})).rejects.toBeInstanceOf(
      ToolCallTimeoutError
    );
  });

  it('passes through a fast result', async () => {
    const caller: ToolCaller = {
      call: vi.fn(async () => ({ ok: true })),
    };

    const bounded = withTimeout(caller, 1000);

    await expect(bounded.call('execute_spec', {})).resolves.toEqual({
      ok: true,
    });
  });

  it('propagates an underlying thrown error unchanged', async () => {
    const underlying = new Error('boom');
    const caller: ToolCaller = {
      call: vi.fn(async () => {
        throw underlying;
      }),
    };

    const bounded = withTimeout(caller, 1000);

    await expect(bounded.call('execute_spec', {})).rejects.toBe(underlying);
  });

  it('aborts the signal on timeout', async () => {
    let captured: AbortSignal | undefined;
    const caller: ToolCaller = {
      call: vi.fn((_tool: string, args: Record<string, unknown>) => {
        captured = args['signal'] as AbortSignal;
        return new Promise<unknown>(() => {});
      }),
    };

    const bounded = withTimeout(caller, 10);

    await expect(bounded.call('execute_spec', {})).rejects.toBeInstanceOf(
      ToolCallTimeoutError
    );
    expect(captured?.aborted).toBe(true);
  });
});

describe('buildTestSpec', () => {
  it('builds valid markdown spec', () => {
    const spec = buildTestSpec('Hello World', 'Print hello');

    expect(spec).toContain('# Hello World');
    expect(spec).toContain('## Requirements');
    expect(spec).toContain('- Print hello');
    expect(spec).toContain('## Acceptance Criteria');
  });
});

// ============================================================================
// runFactoryPipeline
// ============================================================================

describe('runFactoryPipeline', () => {
  it('runs full pipeline with all 3 tools', async () => {
    const toolResponses: Record<string, unknown> = {
      execute_spec: MOCK_DRY_RUN_RESPONSE,
      query_trace: MOCK_TRACE_RESPONSE,
      registry_import: MOCK_REGISTRY_IMPORT_RESPONSE,
    };
    const caller = createMockCaller(toolResponses);

    const config: FactoryConfig = {
      spec: buildTestSpec('Test', 'Do thing'),
      dryRun: true,
      traceRunId: 'run-abc-123',
      registryImport: { provider: 'anthropic', modelId: 'test-model' },
    };

    const result = await runFactoryPipeline(caller, config);

    expect(result.specResult).not.toBeNull();
    expect(result.specError).toBeNull();
    expect(result.traceResult).not.toBeNull();
    expect(result.registryResult).not.toBeNull();
    expect(caller.calls).toHaveLength(3);
  });

  it('captures spec errors without failing pipeline', async () => {
    const toolResponses: Record<string, unknown> = {
      query_trace: MOCK_TRACE_NOT_FOUND,
    };
    const caller: ToolCaller = {
      call: vi.fn(async (toolName: string) => {
        if (toolName === 'execute_spec') {
          throw new Error('Decompose error: no requirements');
        }
        return toolResponses[toolName];
      }),
    };

    const config: FactoryConfig = {
      spec: 'bad spec',
      traceRunId: 'nonexistent',
    };

    const result = await runFactoryPipeline(caller, config);

    expect(result.specResult).toBeNull();
    expect(result.specError).toContain('Decompose error');
    expect(result.traceResult).not.toBeNull();
  });

  it('skips trace and registry when not configured', async () => {
    const caller = createMockCaller({
      execute_spec: MOCK_DRY_RUN_RESPONSE,
    });

    const config: FactoryConfig = {
      spec: buildTestSpec('Test', 'Do thing'),
      dryRun: true,
    };

    const result = await runFactoryPipeline(caller, config);

    expect(result.specResult).not.toBeNull();
    expect(result.traceResult).toBeNull();
    expect(result.registryResult).toBeNull();
    expect(caller.calls).toHaveLength(1);
  });

  it('defaults to dry run mode', async () => {
    const caller = createMockCaller({
      execute_spec: MOCK_DRY_RUN_RESPONSE,
    });

    const config: FactoryConfig = { spec: 'test' };

    await runFactoryPipeline(caller, config);

    expect(caller.calls[0]?.args['dryRun']).toBe(true);
  });
});
