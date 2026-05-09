import type { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import type { DeploymentSigner } from './signingContext';
import type { SuiClient, SuiClientTypes, TransactionEffects, TransactionResult } from './suiClient';

export type RetryLogger = {
  info?: (message: string) => void;
  warning?: (message: string) => void;
};

export type SuiRetryOptions = {
  operation: string;
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  logger?: RetryLogger;
};

/** Per-stage retry counts. Set a stage to 0 to disable retries for that stage. */
export type TransactionStageRetryOptions = {
  buildRetries?: number;
  dryRunRetries?: number;
  signRetries?: number;
  executeRetries?: number;
  waitRetries?: number;
};

export const DEFAULT_GAS_BUDGET_MULTIPLIER_BPS = 11000;
export const DEFAULT_MIN_GAS_BUDGET_BUFFER_MIST = 5_000_000n;

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

export const isRetryableSuiError = (error: unknown): boolean => {
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

export const withSuiRetry = async <T>(
  fn: () => Promise<T>,
  { operation, retries = 5, minDelayMs = 1000, maxDelayMs = 15000, logger }: SuiRetryOptions,
): Promise<T> => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryableSuiError(error);
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

export const buildSignAndExecuteTransactionWithRetry = async (
  suiClient: SuiClient,
  signer: DeploymentSigner,
  transaction: Transaction,
  {
    operation,
    logger,
    retries,
    minDelayMs,
    maxDelayMs,
    buildRetries = retries,
    signRetries = retries,
    executeRetries = retries,
  }: Omit<SuiRetryOptions, 'operation'> &
    TransactionStageRetryOptions & {
      operation: string;
    },
): Promise<TransactionResult<{ effects: true }>> => {
  const txBytes = await withSuiRetry(async () => transaction.build({ client: suiClient }), {
    operation: `${operation}:build`,
    logger,
    retries: buildRetries,
    minDelayMs,
    maxDelayMs,
  });

  const signature = await withSuiRetry(async () => signer.signTransaction(txBytes), {
    operation: `${operation}:sign`,
    logger,
    retries: signRetries,
    minDelayMs,
    maxDelayMs,
  });

  return withSuiRetry(
    async () =>
      suiClient.executeTransaction({
        transaction: txBytes,
        signatures: [signature.signature],
        include: { effects: true },
      }),
    { operation: `${operation}:execute`, logger, retries: executeRetries, minDelayMs, maxDelayMs },
  );
};

export const getTransactionFromResult = <Include extends SuiClientTypes.TransactionInclude>(
  result: SuiClientTypes.TransactionResult<Include>,
): SuiClientTypes.Transaction<Include> =>
  result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;

const getGasBudgetFromSimulation = (
  simulation: SuiClientTypes.SimulateTransactionResult<{ transaction: true; effects: true }>,
): bigint => {
  const simulated = getTransactionFromResult(simulation);
  const selectedBudget = simulated.transaction?.gasData?.budget;
  if (selectedBudget != null) {
    return BigInt(selectedBudget);
  }

  const gasUsed = simulated.effects?.gasUsed;
  if (gasUsed) {
    return BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost);
  }

  throw new Error('Dry run did not return a gas budget or gas usage summary.');
};

export const getCreatedObjectIds = (effects: TransactionEffects): string[] =>
  effects.changedObjects
    .filter(change => change.idOperation === 'Created' && change.outputState === 'ObjectWrite')
    .map(change => change.objectId);

export const calculateGasBudgetWithSafetyMargin = (
  dryRunBudget: string | number | bigint,
  {
    multiplierBps = DEFAULT_GAS_BUDGET_MULTIPLIER_BPS,
    minBufferMist = DEFAULT_MIN_GAS_BUDGET_BUFFER_MIST,
  }: {
    multiplierBps?: number;
    minBufferMist?: string | number | bigint;
  } = {},
): bigint => {
  const budget = BigInt(dryRunBudget);
  const multiplier = BigInt(multiplierBps);
  const minBuffer = BigInt(minBufferMist);
  const multiplied = (budget * multiplier + 9999n) / 10000n;
  const buffered = budget + minBuffer;
  return multiplied > buffered ? multiplied : buffered;
};

export const runTx = async ({
  suiClient,
  signer,
  transaction,
  operation,
  logger,
  retries,
  minDelayMs,
  maxDelayMs,
  waitOptions,
  buildRetries,
  dryRunRetries,
  signRetries,
  executeRetries,
  waitRetries,
  gasBudgetMultiplierBps,
  minGasBudgetBufferMist,
  onTransactionSubmitted,
}: {
  suiClient: SuiClient;
  signer: DeploymentSigner;
  transaction: Transaction;
  waitOptions?: SuiClientTypes.TransactionInclude;
  gasBudgetMultiplierBps?: number;
  minGasBudgetBufferMist?: string | number | bigint;
  onTransactionSubmitted?: () => void;
} & Omit<SuiRetryOptions, 'operation'> &
  TransactionStageRetryOptions & {
    operation: string;
  }) => {
  const sender = normalizeSuiAddress(signer.toSuiAddress());
  const existingSender = transaction.getData().sender;
  if (existingSender && normalizeSuiAddress(existingSender) !== sender) {
    throw new Error(
      `Transaction sender ${existingSender} does not match signing address ${sender}.`,
    );
  }
  transaction.setSenderIfNotSet(sender);

  const dryRunBuildRetries = Math.min(buildRetries ?? retries ?? 5, 2);
  const dryRunTransactionRetries = Math.min(dryRunRetries ?? retries ?? 5, 2);
  const transactionBuildRetries = buildRetries ?? retries;
  const transactionSignRetries = signRetries ?? 0;
  const transactionExecuteRetries = executeRetries ?? retries;
  const transactionWaitRetries = waitRetries ?? retries;

  const dryRunBytes = await withSuiRetry(async () => transaction.build({ client: suiClient }), {
    operation: `${operation}:dryRunBuild`,
    logger,
    retries: dryRunBuildRetries,
    minDelayMs,
    maxDelayMs,
  });

  const simulation = await withSuiRetry(
    async () =>
      suiClient.simulateTransaction({
        transaction: dryRunBytes,
        include: { transaction: true, effects: true },
      }),
    {
      operation: `${operation}:simulateTransaction`,
      logger,
      retries: dryRunTransactionRetries,
      minDelayMs,
      maxDelayMs,
    },
  );
  transaction.setGasBudget(
    calculateGasBudgetWithSafetyMargin(getGasBudgetFromSimulation(simulation), {
      multiplierBps: gasBudgetMultiplierBps,
      minBufferMist: minGasBudgetBufferMist,
    }),
  );

  const executeResult = await buildSignAndExecuteTransactionWithRetry(
    suiClient,
    signer,
    transaction,
    {
      operation,
      logger,
      retries,
      buildRetries: transactionBuildRetries,
      signRetries: transactionSignRetries,
      executeRetries: transactionExecuteRetries,
      minDelayMs,
      maxDelayMs,
    },
  );
  onTransactionSubmitted?.();
  const digest = getTransactionFromResult(executeResult).digest;

  const response = await withSuiRetry(
    async () =>
      suiClient.waitForTransaction({
        digest,
        include: { ...waitOptions, effects: true },
      }),
    {
      operation: `${operation}:waitForTransaction`,
      logger,
      retries: transactionWaitRetries,
      minDelayMs,
      maxDelayMs,
    },
  );
  const transactionResult = getTransactionFromResult(response);
  const effects = transactionResult.effects;

  if (!effects) {
    throw new Error(`Transaction ${digest} did not return effects`);
  }

  if (!effects.status.success) {
    throw new Error(`Transaction ${digest} failed: ${JSON.stringify(effects.status.error)}`);
  }

  return {
    digest,
    effects,
    response,
  };
};
