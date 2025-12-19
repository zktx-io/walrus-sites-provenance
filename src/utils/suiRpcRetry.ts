import type { SuiClient } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';

export type RetryLogger = {
  info?: (message: string) => void;
  warning?: (message: string) => void;
};

export type SuiRpcRetryOptions = {
  operation: string;
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  logger?: RetryLogger;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const jitter = (ms: number) => Math.floor(Math.random() * ms);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const getErrorStatus = (error: unknown): number | undefined => {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
};

export const isRetryableSuiRpcError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status != null) {
    return [408, 425, 429, 500, 502, 503, 504].includes(status);
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('socket hang up') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('eai_again') ||
    message.includes('enotfound') ||
    message.includes('networkerror')
  );
};

export const withSuiRpcRetry = async <T>(
  fn: () => Promise<T>,
  { operation, retries = 5, minDelayMs = 1000, maxDelayMs = 15000, logger }: SuiRpcRetryOptions,
): Promise<T> => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryableSuiRpcError(error);
      const status = getErrorStatus(error);
      const message = getErrorMessage(error);

      if (!retryable || attempt >= retries) {
        const meta =
          status != null
            ? ` (status=${status}, attempt=${attempt}/${retries})`
            : ` (attempt=${attempt}/${retries})`;
        throw new Error(`[sui] ${operation} failed${meta}: ${message}`);
      }

      const baseDelay = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
      const delayMs = Math.min(maxDelayMs, baseDelay + jitter(Math.min(1000, baseDelay)));
      logger?.warning?.(
        `[sui] ${operation} transient failure${status != null ? ` (status=${status})` : ''}; retrying in ${delayMs}ms (${attempt + 1}/${retries})`,
      );
      attempt += 1;
      await sleep(delayMs);
    }
  }
};

export const signAndExecuteTransactionWithRetry = async (
  suiClient: SuiClient,
  signer: Signer,
  transaction: Transaction,
  {
    operation,
    logger,
    retries,
    minDelayMs,
    maxDelayMs,
  }: Omit<SuiRpcRetryOptions, 'operation'> & { operation: string },
): Promise<Awaited<ReturnType<SuiClient['executeTransactionBlock']>>> => {
  const txBytes = await withSuiRpcRetry(async () => transaction.build({ client: suiClient }), {
    operation: `${operation}:build`,
    logger,
    retries,
    minDelayMs,
    maxDelayMs,
  });

  const signature = await withSuiRpcRetry(async () => signer.signTransaction(txBytes), {
    operation: `${operation}:sign`,
    logger,
    retries,
    minDelayMs,
    maxDelayMs,
  });

  return withSuiRpcRetry(
    async () =>
      suiClient.executeTransactionBlock({
        transactionBlock: txBytes,
        signature: signature.signature,
      }),
    { operation: `${operation}:execute`, logger, retries, minDelayMs, maxDelayMs },
  );
};
