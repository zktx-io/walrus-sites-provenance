import { jest } from '@jest/globals';

import type { SiteConfig } from '../../types';

const mockInfo = jest.fn();
const mockWarning = jest.fn();
const mockRunTx = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  warning: mockWarning,
}));
jest.unstable_mockModule('../../utils/suiRetry', () => ({
  runTx: (...args: any[]) => mockRunTx(...args),
}));

let cleanupBlobs: typeof import('./cleanupBlobs').cleanupBlobs;

const config: SiteConfig = {
  network: 'testnet',
  owner: '0x0000000000000000000000000000000000000000000000000000000000000001',
  site_name: 'fixture',
  metadata: { link: '', image_url: '', description: '', project_url: '', creator: '' },
  epochs: 1,
  path: './dist',
};

const walrusClient = {
  deleteBlob: jest.fn(() => (transaction: any) => {
    const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
    return coin;
  }),
};

describe('cleanupBlobs', () => {
  beforeAll(async () => {
    ({ cleanupBlobs } = await import('./cleanupBlobs'));
  });

  beforeEach(() => {
    mockInfo.mockReset();
    mockWarning.mockReset();
    mockRunTx.mockReset();
    mockRunTx.mockResolvedValue({ digest: '0xdigest' });
    walrusClient.deleteBlob.mockClear();
  });

  it('splits cleanup into bounded PTBs and skips empty or duplicate IDs', async () => {
    const ids = ['', ...Array.from({ length: 101 }, (_, index) => `0xblob${index}`), '0xblob0'];

    await cleanupBlobs({
      signer: {} as any,
      suiClient: {} as any,
      config,
      walrusClient: walrusClient as any,
      blobObjectsIds: ids,
    });

    expect(mockRunTx.mock.calls.map(call => call[0].operation)).toEqual([
      'cleanupBlobs:tx1',
      'cleanupBlobs:tx2',
    ]);
    expect(walrusClient.deleteBlob).toHaveBeenCalledTimes(101);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Requested 103, deleted 101, skipped 2'),
    );
  });

  it('continues later cleanup batches after one batch fails and reports the failure', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `0xblob${index}`);
    mockRunTx
      .mockResolvedValueOnce({ digest: '0xdigest1' })
      .mockRejectedValueOnce(new Error('cleanup tx failed'))
      .mockResolvedValueOnce({ digest: '0xdigest3' });

    await expect(
      cleanupBlobs({
        signer: {} as any,
        suiClient: {} as any,
        config,
        walrusClient: walrusClient as any,
        blobObjectsIds: ids,
      }),
    ).rejects.toThrow('Cleanup failed for 100 blob object(s)');

    expect(mockRunTx.mock.calls.map(call => call[0].operation)).toEqual([
      'cleanupBlobs:tx1',
      'cleanupBlobs:tx2',
      'cleanupBlobs:tx3',
    ]);
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Cleanup batch 2 failed'));
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Requested 201, deleted 101, skipped 0, failed 100'),
    );
  });

  it('truncates large cleanup failure summaries after trying every batch', async () => {
    const ids = Array.from({ length: 601 }, (_, index) => `0xblob${index}`);
    mockRunTx.mockRejectedValue(new Error('cleanup tx failed'));

    await expect(
      cleanupBlobs({
        signer: {} as any,
        suiClient: {} as any,
        config,
        walrusClient: walrusClient as any,
        blobObjectsIds: ids,
      }),
    ).rejects.toThrow('and 2 more');

    expect(mockRunTx).toHaveBeenCalledTimes(7);
  });

  it('truncates each cleanup failure message before logging and summarizing it', async () => {
    const longMessage = `cleanup tx failed ${'x'.repeat(400)}`;
    mockRunTx.mockRejectedValue(new Error(longMessage));

    await expect(
      cleanupBlobs({
        signer: {} as any,
        suiClient: {} as any,
        config,
        walrusClient: walrusClient as any,
        blobObjectsIds: ['0xblob'],
      }),
    ).rejects.toThrow('...');

    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('...'));
    expect(mockWarning.mock.calls[0][0].length).toBeLessThan(longMessage.length);
  });

  it('does not build a cleanup transaction when no valid object IDs exist', async () => {
    await cleanupBlobs({
      signer: {} as any,
      suiClient: {} as any,
      config,
      walrusClient: walrusClient as any,
      blobObjectsIds: ['', ''],
    });

    expect(mockRunTx).not.toHaveBeenCalled();
    expect(walrusClient.deleteBlob).not.toHaveBeenCalled();
  });
});
