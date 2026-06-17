import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
  SAFE_RUN_RETRY_STRATEGY,
  decideSafeRunRetry,
  resolveDefaultSafeRunRetryMaxAttempts,
  type RunRetryPolicyInput,
} from '../src/run-retry-policy.js';

function decide(input: Partial<RunRetryPolicyInput> = {}) {
  return decideSafeRunRetry({
    result: 'failed',
    attemptCount: 0,
    failure: {
      failure_category: 'upstream_unavailable',
      failure_detail: 'upstream_5xx',
      failure_stage: 'first_token_wait',
      retryable: true,
    },
    ...input,
  });
}

describe('decideSafeRunRetry', () => {
  it('allows retryable transient upstream failures before side effects', () => {
    expect(decide()).toEqual({
      shouldRetry: true,
      retryAttemptIndex: 1,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
      retryStrategy: SAFE_RUN_RETRY_STRATEGY,
      retryReason: 'transient_failure',
    });
  });

  it('allows ordinary retryable 429 rate limits but suppresses hard quota', () => {
    expect(
      decide({
        failure: {
          failure_category: 'rate_limit',
          failure_detail: 'rate_limit_429',
          failure_stage: 'session_init',
          retryable: true,
        },
      }).shouldRetry,
    ).toBe(true);

    expect(
      decide({
        failure: {
          failure_category: 'rate_limit',
          failure_detail: 'hard_quota',
          failure_stage: 'session_init',
          retryable: false,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'hard_quota',
    });
  });

  it('allows empty output and first-token timeout failures', () => {
    expect(
      decide({
        failure: {
          failure_category: 'empty_output',
          failure_detail: 'empty_output',
          failure_stage: 'first_token_wait',
          retryable: true,
        },
      }).shouldRetry,
    ).toBe(true);

    expect(
      decide({
        failure: {
          failure_category: 'timeout',
          failure_detail: 'inactivity_timeout',
          failure_stage: 'first_token_wait',
          retryable: true,
        },
      }).shouldRetry,
    ).toBe(true);
  });

  it('does not retry successful or cancelled terminal results', () => {
    expect(decide({ result: 'success' })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'not_failed',
    });
    expect(decide({ result: 'cancelled' })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'not_failed',
    });
  });

  it('requires the classifier retryable signal', () => {
    expect(
      decide({
        failure: {
          failure_category: 'upstream_unavailable',
          failure_detail: 'upstream_5xx',
          failure_stage: 'first_token_wait',
          retryable: false,
        },
      }),
    ).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'not_retryable',
    });
  });

  it('suppresses non-transient categories even when the classifier marks them retryable', () => {
    for (const failure_category of [
      'auth',
      'prompt_too_large',
      'model_unavailable',
      'tool_error',
      'process_exit',
      'unknown',
    ] as const) {
      expect(
        decide({
          failure: {
            failure_category,
            failure_stage: 'tool_execution',
            retryable: true,
          },
        }),
      ).toMatchObject({
        shouldRetry: false,
        retrySuppressedReason: 'unsupported_category',
      });
    }
  });

  it('allows at most one automatic same-run retry by default', () => {
    expect(decide({ attemptCount: 0 })).toMatchObject({
      shouldRetry: true,
      retryAttemptIndex: 1,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
    });
    expect(decide({ attemptCount: 1 })).toMatchObject({
      shouldRetry: false,
      retryAttemptIndex: 2,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
      retrySuppressedReason: 'attempt_limit_reached',
    });
  });

  it('stops at the configured attempt limit', () => {
    expect(decide({ attemptCount: 1, maxAttempts: 2 })).toMatchObject({
      shouldRetry: true,
      retryAttemptIndex: 2,
      retryMaxAttempts: 2,
    });
    expect(decide({ attemptCount: 2, maxAttempts: 2 })).toMatchObject({
      shouldRetry: false,
      retryAttemptIndex: 3,
      retryMaxAttempts: 2,
      retrySuppressedReason: 'attempt_limit_reached',
    });
  });

  it('suppresses retries after user-visible output, tools, artifact writes, or live artifacts', () => {
    expect(decide({ sideEffects: { userVisibleOutputSeen: true } })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'user_visible_output_seen',
    });
    expect(decide({ sideEffects: { toolCallSeen: true } })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'tool_call_seen',
    });
    expect(decide({ sideEffects: { artifactWriteSeen: true } })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'artifact_write_seen',
    });
    expect(decide({ sideEffects: { liveArtifactSeen: true } })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'live_artifact_seen',
    });
  });

  it('suppresses retries when cancellation was requested', () => {
    expect(decide({ sideEffects: { cancelRequested: true } })).toMatchObject({
      shouldRetry: false,
      retrySuppressedReason: 'cancel_requested',
    });
  });

  it('never auto-retries process kills, crashes, or interruptions', () => {
    for (const failure_detail of [
      'signal_killed',
      'process_crashed',
      'interrupted',
    ] as const) {
      expect(
        decide({
          failure: {
            failure_category: 'process_exit',
            failure_detail,
            failure_stage: 'child_close',
            retryable: false,
          },
        }).shouldRetry,
      ).toBe(false);
    }
  });
});

describe('resolveDefaultSafeRunRetryMaxAttempts', () => {
  it('falls back to the built-in default when the override is unset, empty, or malformed', () => {
    expect(resolveDefaultSafeRunRetryMaxAttempts({})).toBe(
      DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
    );
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: '' }),
    ).toBe(DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS);
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: '   ' }),
    ).toBe(DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS);
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: 'abc' }),
    ).toBe(DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS);
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: '-1' }),
    ).toBe(DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS);
  });

  it('parses and floors a valid positive override', () => {
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: '2' }),
    ).toBe(2);
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: ' 3 ' }),
    ).toBe(3);
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: '2.9' }),
    ).toBe(2);
    expect(
      resolveDefaultSafeRunRetryMaxAttempts({ OD_SAFE_RUN_RETRY_MAX_ATTEMPTS: '0' }),
    ).toBe(0);
  });
});

describe('decideSafeRunRetry env-driven default ceiling', () => {
  afterEach(() => {
    delete process.env.OD_SAFE_RUN_RETRY_MAX_ATTEMPTS;
  });

  it('honors OD_SAFE_RUN_RETRY_MAX_ATTEMPTS when maxAttempts is not passed', () => {
    process.env.OD_SAFE_RUN_RETRY_MAX_ATTEMPTS = '2';
    // attemptCount=1 would hit the built-in single-attempt cap; the override
    // lifts the ceiling so a second transient respawn is still allowed.
    expect(decide({ attemptCount: 1 })).toMatchObject({
      shouldRetry: true,
      retryAttemptIndex: 2,
      retryMaxAttempts: 2,
    });
    expect(decide({ attemptCount: 2 })).toMatchObject({
      shouldRetry: false,
      retryAttemptIndex: 3,
      retryMaxAttempts: 2,
      retrySuppressedReason: 'attempt_limit_reached',
    });
  });

  it('keeps the single-attempt default when the override is absent', () => {
    expect(decide({ attemptCount: 1 })).toMatchObject({
      shouldRetry: false,
      retryMaxAttempts: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
      retrySuppressedReason: 'attempt_limit_reached',
    });
  });
});
