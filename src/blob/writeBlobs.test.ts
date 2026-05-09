import { jest } from '@jest/globals';
import { blobIdFromInt } from '@mysten/walrus';

import type { BlobDictionary, SiteConfig } from '../types';

const mockCleanupBlobs = jest.fn<(...args: any[]) => Promise<void>>();
const mockWarning = jest.fn();
const mockWriteBlobHelper = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule('@actions/core', () => ({
  warning: mockWarning,
}));
jest.unstable_mockModule('./helper/cleanupBlobs', () => ({
  cleanupBlobs: (...args: any[]) => mockCleanupBlobs(...args),
}));
jest.unstable_mockModule('./helper/writeBlobHelper', () => ({
  writeBlobHelper: (...args: any[]) => mockWriteBlobHelper(...args),
}));

let writeBlobs: typeof import('./writeBlobs').writeBlobs;

const config: SiteConfig = {
  network: 'testnet',
  owner: '0x0000000000000000000000000000000000000000000000000000000000000001',
  site_name: 'fixture',
  metadata: { link: '', image_url: '', description: '', project_url: '', creator: '' },
  epochs: 1,
  path: './dist',
};

const makeBlobs = (): BlobDictionary => {
  const first = blobIdFromInt('5000');
  const second = blobIdFromInt('5001');
  return {
    [first]: {
      objectId: '0xnew',
      files: [],
      metadata: {} as any,
      rootHash: new Uint8Array(),
      sliversByNode: [],
    },
    [second]: {
      objectId: '0xprotected',
      files: [],
      metadata: {} as any,
      rootHash: new Uint8Array(),
      sliversByNode: [],
    },
  };
};

describe('writeBlobs', () => {
  beforeAll(async () => {
    ({ writeBlobs } = await import('./writeBlobs'));
  });

  beforeEach(() => {
    mockCleanupBlobs.mockReset();
    mockCleanupBlobs.mockResolvedValue(undefined);
    mockWarning.mockReset();
    mockWriteBlobHelper.mockReset();
  });

  it('does not cleanup when all uploads succeed', async () => {
    mockWriteBlobHelper.mockResolvedValue([{ signature: 'sig', serializedMessage: 'msg' }]);
    const blobs = makeBlobs();

    const result = await writeBlobs({
      retryLimit: 0,
      signer: {} as any,
      config,
      suiClient: {} as any,
      walrusClient: {} as any,
      blobs,
      protectedBlobIds: new Set(),
    });

    expect(result[Object.keys(result)[0]].confirmations).toEqual([
      { signature: 'sig', serializedMessage: 'msg' },
    ]);
    expect(mockWriteBlobHelper.mock.calls[0][1]).toBe(0);
    expect(mockCleanupBlobs).not.toHaveBeenCalled();
  });

  it('skips cleanup for blob IDs still referenced by the existing site', async () => {
    const blobs = makeBlobs();
    const protectedBlobId = Object.keys(blobs)[1];
    mockWriteBlobHelper.mockRejectedValueOnce(new Error('upload failed'));

    await expect(
      writeBlobs({
        retryLimit: 0,
        signer: {} as any,
        config,
        suiClient: {} as any,
        walrusClient: {} as any,
        blobs,
        protectedBlobIds: new Set([protectedBlobId]),
      }),
    ).rejects.toThrow('upload failed');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({ blobObjectsIds: ['0xnew'] }),
    );
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('still referenced'));
  });

  it('preserves the upload failure when cleanup also fails', async () => {
    mockWriteBlobHelper.mockRejectedValueOnce(new Error('upload failed'));
    mockCleanupBlobs.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(
      writeBlobs({
        retryLimit: 0,
        signer: {} as any,
        config,
        suiClient: {} as any,
        walrusClient: {} as any,
        blobs: makeBlobs(),
      }),
    ).rejects.toThrow('upload failed');

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup after failed blob upload also failed: cleanup failed'),
    );
  });
});
