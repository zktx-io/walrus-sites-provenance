import { jest } from '@jest/globals';

import {
  createGitSignerResponseScanState,
  findGitSignerResponseTransaction,
  type GitSignerResponseScanState,
} from './gitSigner';
import type { SuiClient } from './suiClient';

const EPHEMERAL_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000001';

const mockLogger = {
  warning: jest.fn<(message: string) => void>(),
};

const makeCheckpointTransaction = (digest: string, sender = EPHEMERAL_ADDRESS) => ({
  digest,
  transaction: { sender },
});

const makeClient = ({
  checkpointHeight,
  checkpoints = {},
  transactionCheckpoints = {},
  transactions = {},
}: {
  checkpointHeight: number;
  checkpoints?: Record<number, unknown[]>;
  transactionCheckpoints?: Record<string, number>;
  transactions?: Record<string, unknown>;
}) => {
  const client = {
    ledgerService: {
      getServiceInfo: jest.fn(async () => ({
        response: { checkpointHeight: BigInt(checkpointHeight) },
      })),
      getTransaction: jest.fn(async ({ digest }: { digest: string }) => ({
        response: {
          transaction: {
            checkpoint: BigInt(transactionCheckpoints[digest] ?? checkpointHeight),
          },
        },
      })),
      getCheckpoint: jest.fn(
        async ({
          checkpointId,
        }: {
          checkpointId: { oneofKind: 'sequenceNumber'; sequenceNumber: bigint };
        }) => ({
          response: {
            checkpoint: {
              transactions: checkpoints[Number(checkpointId.sequenceNumber)] ?? [],
            },
          },
        }),
      ),
    },
    getTransaction: jest.fn(async ({ digest }: { digest: string }) => ({
      $kind: 'Transaction',
      Transaction: transactions[digest] ?? {
        digest,
        transaction: { inputs: [] },
      },
    })),
  };

  return client as unknown as SuiClient;
};

describe('GitSigner response checkpoint scanner', () => {
  beforeEach(() => {
    mockLogger.warning.mockReset();
  });

  it('starts scanning from the request transaction checkpoint', async () => {
    const client = makeClient({
      checkpointHeight: 30,
      transactionCheckpoints: { request: 12 },
    });

    await expect(createGitSignerResponseScanState(client, 'request', mockLogger)).resolves.toEqual({
      requestDigest: 'request',
      requestCheckpoint: 12,
      nextCheckpoint: 12,
    });
  });

  it('ignores older same-checkpoint transactions before the request digest', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 12,
      nextCheckpoint: 12,
    };
    const client = makeClient({
      checkpointHeight: 12,
      checkpoints: {
        12: [
          makeCheckpointTransaction('old-response'),
          makeCheckpointTransaction('request'),
          makeCheckpointTransaction('current-response'),
        ],
      },
    });

    const transaction = await findGitSignerResponseTransaction({
      client,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      scanState: state,
      logger: mockLogger,
    });

    expect(transaction?.digest).toBe('current-response');
    expect(client.getTransaction).toHaveBeenCalledWith({
      digest: 'current-response',
      include: { transaction: true },
    });
  });

  it('does not miss a delayed response outside the old 50-checkpoint window', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 10,
      nextCheckpoint: 10,
    };
    const client = makeClient({
      checkpointHeight: 120,
      checkpoints: {
        10: [makeCheckpointTransaction('request')],
        20: [makeCheckpointTransaction('delayed-response')],
      },
    });

    const transaction = await findGitSignerResponseTransaction({
      client,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      scanState: state,
      logger: mockLogger,
    });

    expect(transaction?.digest).toBe('delayed-response');
  });

  it('skips response candidates from a different sender', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 10,
      nextCheckpoint: 10,
    };
    const client = makeClient({
      checkpointHeight: 10,
      checkpoints: {
        10: [
          makeCheckpointTransaction('request'),
          makeCheckpointTransaction(
            'wrong-sender-response',
            '0x0000000000000000000000000000000000000000000000000000000000000002',
          ),
        ],
      },
    });

    await expect(
      findGitSignerResponseTransaction({
        client,
        ephemeralAddress: EPHEMERAL_ADDRESS,
        scanState: state,
        logger: mockLogger,
      }),
    ).resolves.toBeNull();
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('returns null without scanning when the cursor is ahead of the latest checkpoint', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 10,
      nextCheckpoint: 12,
    };
    const client = makeClient({
      checkpointHeight: 11,
    });

    await expect(
      findGitSignerResponseTransaction({
        client,
        ephemeralAddress: EPHEMERAL_ADDRESS,
        scanState: state,
        logger: mockLogger,
      }),
    ).resolves.toBeNull();
    expect(client.ledgerService.getCheckpoint).not.toHaveBeenCalled();
  });

  it('advances the cursor in bounded checkpoint batches', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 10,
      nextCheckpoint: 10,
    };
    const client = makeClient({
      checkpointHeight: 20,
      checkpoints: {
        10: [makeCheckpointTransaction('request')],
      },
    });

    await expect(
      findGitSignerResponseTransaction({
        client,
        ephemeralAddress: EPHEMERAL_ADDRESS,
        scanState: state,
        logger: mockLogger,
        maxCheckpointsPerScan: 3,
      }),
    ).resolves.toBeNull();

    expect(state.nextCheckpoint).toBe(13);
    expect(client.ledgerService.getCheckpoint).toHaveBeenCalledTimes(3);
  });

  it('treats a non-positive max checkpoint batch as one checkpoint', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 10,
      nextCheckpoint: 10,
    };
    const client = makeClient({
      checkpointHeight: 20,
    });

    await expect(
      findGitSignerResponseTransaction({
        client,
        ephemeralAddress: EPHEMERAL_ADDRESS,
        scanState: state,
        logger: mockLogger,
        maxCheckpointsPerScan: 0,
      }),
    ).resolves.toBeNull();

    expect(state.nextCheckpoint).toBe(11);
    expect(client.ledgerService.getCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the request transaction checkpoint is missing', async () => {
    const client = {
      ledgerService: {
        getTransaction: jest.fn(async () => ({
          response: {
            transaction: {},
          },
        })),
      },
    } as unknown as SuiClient;

    await expect(createGitSignerResponseScanState(client, 'request', mockLogger)).rejects.toThrow(
      'transaction request did not return a checkpoint',
    );
  });

  it('fails clearly when checkpoint height exceeds a safe JavaScript number', async () => {
    const state: GitSignerResponseScanState = {
      requestDigest: 'request',
      requestCheckpoint: 10,
      nextCheckpoint: 10,
    };
    const client = {
      ledgerService: {
        getServiceInfo: jest.fn(async () => ({
          response: { checkpointHeight: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
        })),
      },
    } as unknown as SuiClient;

    await expect(
      findGitSignerResponseTransaction({
        client,
        ephemeralAddress: EPHEMERAL_ADDRESS,
        scanState: state,
        logger: mockLogger,
      }),
    ).rejects.toThrow('getServiceInfo returned an unsafe checkpoint value');
  });
});
