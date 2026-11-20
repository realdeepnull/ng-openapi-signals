export function generateMutationUtils(): string {
  return `import { signal, computed, type Signal } from '@angular/core';

export type MutationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface Mutation<TBody, TResult> {
  readonly result: Signal<TResult | undefined>;
  readonly error: Signal<unknown | undefined>;
  readonly status: Signal<MutationStatus>;
  readonly isLoading: Signal<boolean>;
  mutate(body: TBody, signal?: AbortSignal): Promise<TResult>;
  reset(): void;
}

export function createMutation<TBody, TResult>(
  fn: (body: TBody, signal?: AbortSignal) => Promise<TResult>,
): Mutation<TBody, TResult> {
  const result = signal<TResult | undefined>(undefined);
  const error = signal<unknown | undefined>(undefined);
  const status = signal<MutationStatus>('idle');
  const isLoading = computed(() => status() === 'loading');

  // Monotonic sequence of the latest mutate() call. In-flight guards: only
  // the most recent call may write result/error/status — a stale call that
  // resolves after a newer one was started is ignored, so parallel calls
  // can no longer overlap each other's state.
  let latestCall = 0;

  async function mutate(body: TBody, signal?: AbortSignal): Promise<TResult> {
    const call = ++latestCall;
    status.set('loading');
    error.set(undefined);
    try {
      const res = await fn(body, signal);
      if (call !== latestCall) {
        // A newer call superseded this one — do not touch state.
        return res;
      }
      result.set(res);
      status.set('success');
      return res;
    } catch (e) {
      if (call !== latestCall) {
        // A newer call superseded this one — do not touch state.
        throw e;
      }
      error.set(e);
      status.set('error');
      throw e;
    }
  }

  function reset(): void {
    // Invalidate any in-flight call so a late resolution cannot repopulate
    // result/error/status after the reset.
    latestCall++;
    result.set(undefined);
    error.set(undefined);
    status.set('idle');
  }

  return { result, error, status, isLoading, mutate, reset };
}
`;
}
