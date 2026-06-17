import type {
  TrackingRunFailureCategory,
  TrackingRunFailureDetail,
  TrackingRunFailureStage,
  TrackingRunRetryStrategy,
  TrackingRunRetrySuppressedReason,
  TrackingRunResult,
} from '@open-design/contracts/analytics';

// Counts automatic same-run retry attempts, not the initial run. Issue #3543
// scopes the first implementation to at most one automatic same-run retry, so
// the default caps retries at a single attempt (attemptCount >= 1 suppresses
// with attempt_limit_reached).
export const DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS = 1;
export const SAFE_RUN_RETRY_STRATEGY: TrackingRunRetryStrategy = 'same_run_transient';

// Operator override for the built-in single-attempt cap (issue #3543). A
// deployment sitting behind a flappy egress proxy can lose the egress for
// longer than one fresh-respawn cycle, so a single automatic retry still ends
// in a failed run. `OD_SAFE_RUN_RETRY_MAX_ATTEMPTS` raises the ceiling so a
// multi-cycle transient drop gets more respawns before the run is declared
// failed. This only widens the count: eligibility stays restricted to
// transient categories (see isTransientRetryCategory) and every side-effect
// gate still applies, so a higher ceiling never re-runs a turn that already
// produced visible output or touched an artifact. An unset, empty, malformed,
// or negative value falls back to the built-in default.
export function resolveDefaultSafeRunRetryMaxAttempts(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.OD_SAFE_RUN_RETRY_MAX_ATTEMPTS?.trim();
  if (!raw) return DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS;
  }
  return Math.floor(parsed);
}

export interface RunRetryFailureSignal {
  failure_category?: TrackingRunFailureCategory;
  failure_detail?: TrackingRunFailureDetail;
  failure_stage?: TrackingRunFailureStage;
  retryable?: boolean;
}

export interface RunRetrySideEffectState {
  cancelRequested?: boolean;
  userVisibleOutputSeen?: boolean;
  toolCallSeen?: boolean;
  artifactWriteSeen?: boolean;
  liveArtifactSeen?: boolean;
}

export interface RunRetryPolicyInput {
  result: TrackingRunResult;
  failure?: RunRetryFailureSignal;
  attemptCount: number;
  maxAttempts?: number;
  sideEffects?: RunRetrySideEffectState;
}

export type RunRetryPolicyDecision =
  | {
      shouldRetry: true;
      retryAttemptIndex: number;
      retryMaxAttempts: number;
      retryStrategy: TrackingRunRetryStrategy;
      retryReason: 'transient_failure';
    }
  | {
      shouldRetry: false;
      retryAttemptIndex: number;
      retryMaxAttempts: number;
      retryStrategy: TrackingRunRetryStrategy;
      retrySuppressedReason: TrackingRunRetrySuppressedReason;
    };

function normalizeAttemptCount(attemptCount: number): number {
  if (!Number.isFinite(attemptCount) || attemptCount < 0) return 0;
  return Math.floor(attemptCount);
}

function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined) return resolveDefaultSafeRunRetryMaxAttempts();
  if (!Number.isFinite(maxAttempts) || maxAttempts < 0) return 0;
  return Math.floor(maxAttempts);
}

function isTransientRetryCategory(
  category: TrackingRunFailureCategory | undefined,
  detail: TrackingRunFailureDetail | undefined,
  stage: TrackingRunFailureStage | undefined,
): boolean {
  if (category === 'rate_limit') return detail !== 'hard_quota';
  if (category === 'upstream_unavailable') return true;
  if (category === 'empty_output') return stage === undefined || stage === 'first_token_wait';
  if (category === 'timeout') return stage === 'first_token_wait';
  return false;
}

export function decideSafeRunRetry(
  input: RunRetryPolicyInput,
): RunRetryPolicyDecision {
  const attemptCount = normalizeAttemptCount(input.attemptCount);
  const retryMaxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const retryAttemptIndex = attemptCount + 1;
  const base = {
    retryAttemptIndex,
    retryMaxAttempts,
    retryStrategy: SAFE_RUN_RETRY_STRATEGY,
  };
  const suppress = (
    retrySuppressedReason: TrackingRunRetrySuppressedReason,
  ): RunRetryPolicyDecision => ({
    ...base,
    shouldRetry: false,
    retrySuppressedReason,
  });

  if (input.result !== 'failed') return suppress('not_failed');

  const sideEffects = input.sideEffects ?? {};
  if (sideEffects.cancelRequested) return suppress('cancel_requested');

  const failure = input.failure;
  if (failure?.failure_detail === 'hard_quota') return suppress('hard_quota');
  if (
    failure?.failure_category !== undefined &&
    !isTransientRetryCategory(
      failure.failure_category,
      failure.failure_detail,
      failure.failure_stage,
    )
  ) {
    return suppress('unsupported_category');
  }
  if (!failure?.retryable) return suppress('not_retryable');
  if (
    !isTransientRetryCategory(
      failure.failure_category,
      failure.failure_detail,
      failure.failure_stage,
    )
  ) {
    return suppress('unsupported_category');
  }
  if (attemptCount >= retryMaxAttempts) return suppress('attempt_limit_reached');
  if (sideEffects.userVisibleOutputSeen) return suppress('user_visible_output_seen');
  if (sideEffects.toolCallSeen) return suppress('tool_call_seen');
  if (sideEffects.artifactWriteSeen) return suppress('artifact_write_seen');
  if (sideEffects.liveArtifactSeen) return suppress('live_artifact_seen');

  return {
    ...base,
    shouldRetry: true,
    retryReason: 'transient_failure',
  };
}
