import { jest } from '@jest/globals';

import {
  createGitSignerResponseScanState,
  findGitSignerResponseTransaction,
  splitGitSignerTransportBytes,
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
      baselineDigest: 'request',
      baselineCheckpoint: 12,
    });
  });

  it('ignores older same-checkpoint transactions before the request digest', async () => {
    const state: GitSignerResponseScanState = {
      baselineDigest: 'request',
      baselineCheckpoint: 12,
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
      baselineDigest: 'request',
      baselineCheckpoint: 10,
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

  it('uses the request digest as the sent-transaction boundary', async () => {
    const state: GitSignerResponseScanState = {
      baselineDigest: 'request',
      baselineCheckpoint: 10,
    };
    const client = makeClient({
      checkpointHeight: 200,
      checkpoints: {
        10: [makeCheckpointTransaction('request')],
        150: [makeCheckpointTransaction('response-after-baseline')],
      },
    });

    const transaction = await findGitSignerResponseTransaction({
      client,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      scanState: state,
      logger: mockLogger,
    });

    expect(transaction?.digest).toBe('response-after-baseline');
  });

  it('uses the request digest boundary even when the request sender is omitted', async () => {
    const state: GitSignerResponseScanState = {
      baselineDigest: 'request',
      baselineCheckpoint: 10,
    };
    const client = makeClient({
      checkpointHeight: 11,
      checkpoints: {
        10: [{ digest: 'request' }],
        11: [makeCheckpointTransaction('response')],
      },
    });

    const transaction = await findGitSignerResponseTransaction({
      client,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      scanState: state,
      logger: mockLogger,
    });

    expect(transaction?.digest).toBe('response');
  });

  it('skips response candidates from a different sender', async () => {
    const state: GitSignerResponseScanState = {
      baselineDigest: 'request',
      baselineCheckpoint: 10,
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

  it('rescans from the request checkpoint on each poll', async () => {
    const state: GitSignerResponseScanState = {
      baselineDigest: 'request',
      baselineCheckpoint: 10,
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
    expect(client.ledgerService.getCheckpoint).toHaveBeenCalledTimes(2);
  });

  it('waits until the request checkpoint is visible before scanning', async () => {
    const state: GitSignerResponseScanState = {
      baselineDigest: 'request',
      baselineCheckpoint: 12,
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
      baselineDigest: 'request',
      baselineCheckpoint: 10,
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

describe('GitSigner transport payload chunking', () => {
  it('splits long signing requests into one transaction with multiple inputs', () => {
    const input = new Uint8Array(32761).map((_, index) => index % 256);

    const chunks = splitGitSignerTransportBytes(input);

    expect(chunks.map(chunk => chunk.length)).toEqual([16380, 16380, 1]);
    expect(Array.from(chunks[0].slice(0, 4))).toEqual([0, 1, 2, 3]);
    expect(chunks[2][0]).toBe(32760 % 256);
  });

  it('keeps signature-only signer responses within one chunk', () => {
    const signatureOnlyResponse = new TextEncoder().encode(
      JSON.stringify({
        intent: 'TransactionData',
        signature: 'A'.repeat(100),
      }),
    );

    const chunks = splitGitSignerTransportBytes(signatureOnlyResponse);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(signatureOnlyResponse);
  });
});
