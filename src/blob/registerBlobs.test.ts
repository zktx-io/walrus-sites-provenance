import { jest } from '@jest/globals';
import { blobIdFromInt } from '@mysten/walrus';

import { FileGroup, SiteConfig } from '../types';

const mockCore = {
  info: jest.fn<(message: string) => void>(),
  warning: jest.fn<(message: string) => void>(),
};
const mockRunTx = jest.fn<(...args: any[]) => Promise<any>>();
const mockGetAllObjects = jest.fn<(...args: any[]) => Promise<any[]>>();
const mockCleanupBlobs = jest.fn<(...args: any[]) => Promise<void>>();

jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('../utils/suiRetry', () => ({
  runTx: (...args: any[]) => mockRunTx(...args),
  getCreatedObjectIds: (effects: any) =>
    effects.changedObjects
      .filter(
        (change: any) => change.idOperation === 'Created' && change.outputState === 'ObjectWrite',
      )
      .map((change: any) => change.objectId),
}));
jest.unstable_mockModule('../utils/getAllObjects', () => ({
  getAllObjects: (...args: any[]) => mockGetAllObjects(...args),
}));
jest.unstable_mockModule('./helper/cleanupBlobs', () => ({
  cleanupBlobs: (...args: any[]) => mockCleanupBlobs(...args),
}));

let registerBlobs: typeof import('./registerBlobs').registerBlobs;

const config: SiteConfig = {
  network: 'testnet',
  owner: '0x0000000000000000000000000000000000000000000000000000000000000001',
  site_name: 'fixture',
  metadata: {
    link: '',
    image_url: '',
    description: '',
    project_url: '',
    creator: '',
  },
  epochs: 1,
  path: './dist',
};

const group = (index: number): FileGroup => ({
  groupId: index,
  size: 10,
  files: [
    {
      name: `/file-${index}.html`,
      path: `/tmp/file-${index}.html`,
      size: 10,
      hash: String(index + 1),
      buffer: Buffer.from(`file-${index}`),
      headers: {
        'Content-Type': 'text/html',
        'Content-Encoding': 'identity',
      },
    },
  ],
});

describe('registerBlobs', () => {
  beforeAll(async () => {
    ({ registerBlobs } = await import('./registerBlobs'));
  });

  beforeEach(() => {
    mockCore.info.mockReset();
    mockCore.warning.mockReset();
    mockRunTx.mockReset();
    mockGetAllObjects.mockReset();
    mockCleanupBlobs.mockReset();
    mockCleanupBlobs.mockResolvedValue(undefined);
  });

  it('splits more than 100 blob registrations across PTBs and maps created objects per batch', async () => {
    let encodeIndex = 0;
    const walrusClient = {
      encodeQuilt: jest.fn(async ({ blobs }: any) => ({
        quilt: Buffer.from(blobs[0].identifier),
        index: {
          patches: blobs.map((blob: any) => ({
            identifier: blob.identifier,
            startIndex: 1,
            endIndex: 1,
          })),
        },
      })),
      encodeBlob: jest.fn(async () => {
        const blobInt = 1000 + encodeIndex;
        encodeIndex += 1;
        return {
          blobId: blobIdFromInt(String(blobInt)),
          metadata: {},
          sliversByNode: [],
          rootHash: new Uint8Array([blobInt % 255]),
        };
      }),
      storageCost: jest.fn(async () => ({
        storageCost: 1n,
        writeCost: 1n,
        totalCost: 2n,
      })),
      registerBlob: jest.fn(() => (transaction: any) => {
        const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
        return coin;
      }),
      getBlobObject: jest.fn(async (objectId: string) => {
        const index = Number(objectId.replace('0xblob', ''));
        return {
          id: objectId,
          blob_id: String(1000 + index),
        };
      }),
    };

    mockRunTx.mockImplementation(async () => {
      const batchIndex = mockRunTx.mock.calls.length - 1;
      const start = batchIndex === 0 ? 0 : 100;
      const length = batchIndex === 0 ? 100 : 1;
      const objectIds = Array.from({ length }, (_, offset) => `0xblob${start + offset}`);
      return {
        digest: `digest-${batchIndex + 1}`,
        effects: {
          changedObjects: objectIds.map(objectId => ({
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            objectId,
          })),
        },
      };
    });
    mockGetAllObjects.mockImplementation(async (_client, { ids }) =>
      ids.map((objectId: string) => ({
        objectId,
        type: '0xblobpkg::blob::Blob',
      })),
    );

    const result = await registerBlobs({
      config,
      suiClient: {} as any,
      walrusClient: walrusClient as any,
      walrusSystem: { blobPackageId: '0xblobpkg', sitePackageId: '0xsitepkg' },
      groups: Array.from({ length: 101 }, (_, index) => group(index)),
      walBlance: 1_000n,
      signer: { toSuiAddress: () => config.owner } as any,
    });

    expect(mockRunTx).toHaveBeenCalledTimes(2);
    expect(mockRunTx.mock.calls.map(call => call[0].operation)).toEqual([
      'registerBlobs:tx1',
      'registerBlobs:tx2',
    ]);
    expect(walrusClient.registerBlob).toHaveBeenCalledTimes(101);
    expect(result[blobIdFromInt('1000')].objectId).toBe('0xblob0');
    expect(result[blobIdFromInt('1100')].objectId).toBe('0xblob100');
  });

  it('cleans up already registered blob objects when a later registration batch fails', async () => {
    let encodeIndex = 0;
    const walrusClient = {
      encodeQuilt: jest.fn(async ({ blobs }: any) => ({
        quilt: Buffer.from(blobs[0].identifier),
        index: {
          patches: blobs.map((blob: any) => ({
            identifier: blob.identifier,
            startIndex: 1,
            endIndex: 1,
          })),
        },
      })),
      encodeBlob: jest.fn(async () => {
        const blobInt = 2000 + encodeIndex;
        encodeIndex += 1;
        return {
          blobId: blobIdFromInt(String(blobInt)),
          metadata: {},
          sliversByNode: [],
          rootHash: new Uint8Array([blobInt % 255]),
        };
      }),
      storageCost: jest.fn(async () => ({
        storageCost: 1n,
        writeCost: 1n,
        totalCost: 2n,
      })),
      registerBlob: jest.fn(() => (transaction: any) => {
        const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
        return coin;
      }),
      getBlobObject: jest.fn(async (objectId: string) => {
        const index = Number(objectId.replace('0xblob', ''));
        return {
          id: objectId,
          blob_id: String(2000 + index),
        };
      }),
    };

    mockRunTx
      .mockImplementationOnce(async () => ({
        digest: 'digest-1',
        effects: {
          changedObjects: Array.from({ length: 100 }, (_, index) => ({
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            objectId: `0xblob${index}`,
          })),
        },
      }))
      .mockRejectedValueOnce(new Error('registration batch failed'));
    mockGetAllObjects.mockImplementation(async (_client, { ids }) =>
      ids.map((objectId: string) => ({
        objectId,
        type: '0xblobpkg::blob::Blob',
      })),
    );

    await expect(
      registerBlobs({
        config,
        suiClient: {} as any,
        walrusClient: walrusClient as any,
        walrusSystem: { blobPackageId: '0xblobpkg', sitePackageId: '0xsitepkg' },
        groups: Array.from({ length: 101 }, (_, index) => group(index)),
        walBlance: 1_000n,
        signer: { toSuiAddress: () => config.owner } as any,
      }),
    ).rejects.toThrow('registration batch failed');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        blobObjectsIds: Array.from({ length: 100 }, (_, index) => `0xblob${index}`),
      }),
    );
  });

  it('keeps protected registered blob objects out of cleanup after object mapping succeeds', async () => {
    let encodeIndex = 0;
    const protectedBlobId = blobIdFromInt('2100');
    const walrusClient = {
      encodeQuilt: jest.fn(async ({ blobs }: any) => ({
        quilt: Buffer.from(blobs[0].identifier),
        index: {
          patches: blobs.map((blob: any) => ({
            identifier: blob.identifier,
            startIndex: 1,
            endIndex: 1,
          })),
        },
      })),
      encodeBlob: jest.fn(async () => {
        const blobInt = 2100 + encodeIndex;
        encodeIndex += 1;
        return {
          blobId: blobIdFromInt(String(blobInt)),
          metadata: {},
          sliversByNode: [],
          rootHash: new Uint8Array([blobInt % 255]),
        };
      }),
      storageCost: jest.fn(async () => ({
        storageCost: 1n,
        writeCost: 1n,
        totalCost: 2n,
      })),
      registerBlob: jest.fn(() => (transaction: any) => {
        const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
        return coin;
      }),
      getBlobObject: jest.fn(async (objectId: string) => {
        const index = Number(objectId.replace('0xblob', ''));
        return {
          id: `0xparsed${index}`,
          blob_id: String(2100 + index),
        };
      }),
    };

    mockRunTx
      .mockImplementationOnce(async () => ({
        digest: 'digest-1',
        effects: {
          changedObjects: Array.from({ length: 100 }, (_, index) => ({
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            objectId: `0xblob${index}`,
          })),
        },
      }))
      .mockRejectedValueOnce(new Error('registration batch failed'));
    mockGetAllObjects.mockImplementation(async (_client, { ids }) =>
      ids.map((objectId: string) => ({
        objectId,
        type: '0xblobpkg::blob::Blob',
      })),
    );

    await expect(
      registerBlobs({
        config,
        suiClient: {} as any,
        walrusClient: walrusClient as any,
        walrusSystem: { blobPackageId: '0xblobpkg', sitePackageId: '0xsitepkg' },
        groups: Array.from({ length: 101 }, (_, index) => group(index)),
        walBlance: 1_000n,
        signer: { toSuiAddress: () => config.owner } as any,
        protectedBlobIds: new Set([protectedBlobId]),
      }),
    ).rejects.toThrow('registration batch failed');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        blobObjectsIds: Array.from({ length: 99 }, (_, index) => `0xblob${index + 1}`),
      }),
    );
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('still referenced'));
  });

  it('cleans up created blob objects if post-registration object parsing fails', async () => {
    const blobId = blobIdFromInt('3000');
    const walrusClient = {
      encodeQuilt: jest.fn(async ({ blobs }: any) => ({
        quilt: Buffer.from(blobs[0].identifier),
        index: {
          patches: blobs.map((blob: any) => ({
            identifier: blob.identifier,
            startIndex: 1,
            endIndex: 1,
          })),
        },
      })),
      encodeBlob: jest.fn(async () => ({
        blobId,
        metadata: {},
        sliversByNode: [],
        rootHash: new Uint8Array([1]),
      })),
      storageCost: jest.fn(async () => ({
        storageCost: 1n,
        writeCost: 1n,
        totalCost: 2n,
      })),
      registerBlob: jest.fn(() => (transaction: any) => {
        const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
        return coin;
      }),
      getBlobObject: jest.fn(async () => {
        throw new Error('object parse failed');
      }),
    };

    mockRunTx.mockResolvedValueOnce({
      digest: 'digest-1',
      effects: {
        changedObjects: [
          {
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            objectId: '0xblob0',
          },
        ],
      },
    });
    mockGetAllObjects.mockResolvedValueOnce([
      {
        objectId: '0xblob0',
        type: '0xblobpkg::blob::Blob',
      },
    ]);

    await expect(
      registerBlobs({
        config,
        suiClient: {} as any,
        walrusClient: walrusClient as any,
        walrusSystem: { blobPackageId: '0xblobpkg', sitePackageId: '0xsitepkg' },
        groups: [group(0)],
        walBlance: 1_000n,
        signer: { toSuiAddress: () => config.owner } as any,
      }),
    ).rejects.toThrow('object parse failed');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        blobObjectsIds: ['0xblob0'],
      }),
    );
  });

  it('cleans up created blob objects if object lookup fails after registration commits', async () => {
    const blobId = blobIdFromInt('3001');
    const walrusClient = {
      encodeQuilt: jest.fn(async ({ blobs }: any) => ({
        quilt: Buffer.from(blobs[0].identifier),
        index: {
          patches: blobs.map((blob: any) => ({
            identifier: blob.identifier,
            startIndex: 1,
            endIndex: 1,
          })),
        },
      })),
      encodeBlob: jest.fn(async () => ({
        blobId,
        metadata: {},
        sliversByNode: [],
        rootHash: new Uint8Array([1]),
      })),
      storageCost: jest.fn(async () => ({
        storageCost: 1n,
        writeCost: 1n,
        totalCost: 2n,
      })),
      registerBlob: jest.fn(() => (transaction: any) => {
        const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
        return coin;
      }),
      getBlobObject: jest.fn(),
    };

    mockRunTx.mockResolvedValueOnce({
      digest: 'digest-1',
      effects: {
        changedObjects: [
          {
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            objectId: '0xblob0',
          },
        ],
      },
    });
    mockGetAllObjects.mockRejectedValueOnce(new Error('object lookup failed'));

    await expect(
      registerBlobs({
        config,
        suiClient: {} as any,
        walrusClient: walrusClient as any,
        walrusSystem: { blobPackageId: '0xblobpkg', sitePackageId: '0xsitepkg' },
        groups: [group(0)],
        walBlance: 1_000n,
        signer: { toSuiAddress: () => config.owner } as any,
      }),
    ).rejects.toThrow('object lookup failed');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        blobObjectsIds: ['0xblob0'],
      }),
    );
  });
});
