import { jest } from '@jest/globals';

import type { DeploymentSigner } from './signingContext';
import {
  calculateGasBudgetWithSafetyMargin,
  DEFAULT_MIN_GAS_BUDGET_BUFFER_MIST,
  getCreatedObjectIds,
  isRetryableSuiError,
  runTx,
} from './suiRetry';

const createMockTransaction = (sender?: string) => {
  let currentSender = sender;
  return {
    build: jest.fn<() => Promise<Uint8Array>>().mockResolvedValue(new Uint8Array([1, 2, 3])),
    getData: jest.fn(() => ({ sender: currentSender })),
    setGasBudget: jest.fn(),
    setSenderIfNotSet: jest.fn((nextSender: string) => {
      currentSender ??= nextSender;
    }),
  };
};

const createMockSuiClient = () => ({
  simulateTransaction: jest.fn<() => Promise<any>>().mockResolvedValue({
    $kind: 'Transaction',
    Transaction: {
      digest: '0xsimulation',
      transaction: {
        gasData: {
          budget: '100000000000',
        },
      },
      effects: {
        status: {
          success: true,
          error: null,
        },
        changedObjects: [],
      },
    },
  }),
  executeTransaction: jest.fn<() => Promise<any>>().mockResolvedValue({
    $kind: 'Transaction',
    Transaction: {
      digest: '0xdigest',
      effects: {
        status: {
          success: true,
          error: null,
        },
        changedObjects: [],
      },
    },
  }),
  waitForTransaction: jest.fn<() => Promise<any>>().mockResolvedValue({
    $kind: 'Transaction',
    Transaction: {
      digest: '0xdigest',
      effects: {
        status: {
          success: true,
          error: null,
        },
        changedObjects: [],
      },
    },
  }),
});

const createMockSigner = (): DeploymentSigner & {
  signTransaction: jest.MockedFunction<DeploymentSigner['signTransaction']>;
  signPersonalMessage: jest.MockedFunction<DeploymentSigner['signPersonalMessage']>;
} => ({
  toSuiAddress: jest.fn(() => '0x1'),
  signTransaction: jest
    .fn<DeploymentSigner['signTransaction']>()
    .mockResolvedValue({ bytes: 'tx-bytes', signature: 'signature' }),
  signPersonalMessage: jest.fn<DeploymentSigner['signPersonalMessage']>(),
});

describe('calculateGasBudgetWithSafetyMargin', () => {
  it('adds the minimum MIST buffer when 10 percent would be too small', () => {
    expect(calculateGasBudgetWithSafetyMargin('1')).toBe(1n + DEFAULT_MIN_GAS_BUDGET_BUFFER_MIST);
  });

  it('uses the multiplier when it is larger than the minimum buffer', () => {
    expect(calculateGasBudgetWithSafetyMargin('100000000000')).toBe(110000000000n);
  });
});

describe('Sui retry helpers', () => {
  it('classifies retryable status codes and network messages', () => {
    expect(isRetryableSuiError({ status: 429 })).toBe(true);
    expect(isRetryableSuiError({ status: 400 })).toBe(false);
    expect(isRetryableSuiError(new Error('fetch failed'))).toBe(true);
  });

  it('extracts only newly created object writes from gRPC effects', () => {
    expect(
      getCreatedObjectIds({
        changedObjects: [
          { objectId: '0x1', idOperation: 'Created', outputState: 'ObjectWrite' },
          { objectId: '0x2', idOperation: 'Created', outputState: 'PackageWrite' },
          { objectId: '0x3', idOperation: 'None', outputState: 'ObjectWrite' },
        ],
      } as any),
    ).toEqual(['0x1']);
  });
});

describe('runTx', () => {
  it('rejects a transaction sender that differs from the signing address', async () => {
    const transaction = createMockTransaction('0x2');
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
      }),
    ).rejects.toThrow('does not match signing address');

    expect(suiClient.simulateTransaction).not.toHaveBeenCalled();
    expect(transaction.setSenderIfNotSet).not.toHaveBeenCalled();
  });

  it('sets a buffered gas budget and forces effects in wait options', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();

    const result = await runTx({
      suiClient: suiClient as any,
      signer,
      transaction: transaction as any,
      operation: 'test',
      waitOptions: { effects: false, events: true },
    });

    expect(result.digest).toBe('0xdigest');
    expect(transaction.setSenderIfNotSet).toHaveBeenCalledWith(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );
    expect(transaction.setGasBudget).toHaveBeenCalledWith(110000000000n);
    expect(suiClient.simulateTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      include: { transaction: true, effects: true },
    });
    expect(suiClient.executeTransaction).toHaveBeenCalledWith({
      transaction: new Uint8Array([1, 2, 3]),
      signatures: ['signature'],
      include: { effects: true },
    });
    expect(suiClient.waitForTransaction).toHaveBeenCalledWith({
      digest: '0xdigest',
      include: { effects: true, events: true },
    });
  });

  it('notifies after executeTransaction returns a digest', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    const events: string[] = [];
    suiClient.executeTransaction.mockImplementationOnce(async () => {
      events.push('execute');
      return {
        $kind: 'Transaction',
        Transaction: {
          digest: '0xdigest',
          effects: {
            status: {
              success: true,
              error: null,
            },
            changedObjects: [],
          },
        },
      };
    });

    await runTx({
      suiClient: suiClient as any,
      signer,
      transaction: transaction as any,
      operation: 'test',
      onTransactionSubmitted: () => {
        events.push('submitted');
      },
    });

    expect(events).toEqual(['execute', 'submitted']);
  });

  it('does not notify submission when executeTransaction fails before returning a digest', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    const events: string[] = [];
    suiClient.executeTransaction.mockImplementationOnce(async () => {
      events.push('execute');
      throw new Error('invalid transaction');
    });

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
        onTransactionSubmitted: () => {
          events.push('submitted');
        },
      }),
    ).rejects.toThrow('test:execute failed');

    expect(events).toEqual(['execute']);
  });

  it('caps dry-run build retries even when buildRetries is higher', async () => {
    const transaction = createMockTransaction();
    transaction.build.mockRejectedValue(new Error('fetch failed'));
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
        buildRetries: 10,
        minDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).rejects.toThrow('test:dryRunBuild failed');

    expect(transaction.build).toHaveBeenCalledTimes(3);
    expect(suiClient.simulateTransaction).not.toHaveBeenCalled();
  });

  it('does not retry transaction signing by default', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    signer.signTransaction.mockRejectedValue(new Error('fetch failed'));

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
        minDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).rejects.toThrow('test:sign failed');

    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(suiClient.executeTransaction).not.toHaveBeenCalled();
  });

  it('honors an explicit sign retry override', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    signer.signTransaction
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ bytes: 'tx-bytes', signature: 'signature' });

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
        signRetries: 2,
        minDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).resolves.toMatchObject({ digest: '0xdigest' });

    expect(signer.signTransaction).toHaveBeenCalledTimes(3);
    expect(suiClient.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses gas usage when simulation does not return an explicit gas budget', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    suiClient.simulateTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: {
        digest: '0xsimulation',
        transaction: {},
        effects: {
          gasUsed: {
            computationCost: '100',
            storageCost: '200',
          },
          status: {
            success: true,
            error: null,
          },
          changedObjects: [],
        },
      },
    });

    await runTx({
      suiClient: suiClient as any,
      signer,
      transaction: transaction as any,
      operation: 'test',
    });

    expect(transaction.setGasBudget).toHaveBeenCalledWith(5_000_300n);
  });

  it('fails when the confirmed transaction does not include effects', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    suiClient.waitForTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: {
        digest: '0xdigest',
      },
    });

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
      }),
    ).rejects.toThrow('did not return effects');
  });

  it('fails when the confirmed transaction status is unsuccessful', async () => {
    const transaction = createMockTransaction();
    const suiClient = createMockSuiClient();
    const signer = createMockSigner();
    suiClient.waitForTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: {
        digest: '0xdigest',
        effects: {
          status: {
            success: false,
            error: { message: 'boom', Unknown: null },
          },
          changedObjects: [],
        },
      },
    });

    await expect(
      runTx({
        suiClient: suiClient as any,
        signer,
        transaction: transaction as any,
        operation: 'test',
      }),
    ).rejects.toThrow('boom');
  });
});
