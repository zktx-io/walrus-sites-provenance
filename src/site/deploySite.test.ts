import { jest } from '@jest/globals';
import { blobIdFromInt } from '@mysten/walrus';

import type { BlobDictionary, QuiltResourceFile } from '../types';

import type { OldBlobObjectCandidate } from './helper/getOldBlobObjectCandidates';

const mockCleanupBlobs = jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined);
const mockGetAllObjects = jest.fn<(...args: any[]) => Promise<any[]>>();
const mockInfo = jest.fn();
const mockGetCreatedObjectIds = jest.fn();
const mockRunTx = jest.fn<(...args: any[]) => Promise<any>>();
const mockSetFailed = jest.fn();
const mockSetOutput = jest.fn();
const mockWarning = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  setFailed: mockSetFailed,
  setOutput: mockSetOutput,
  warning: mockWarning,
}));

jest.unstable_mockModule('../blob/helper/cleanupBlobs', () => ({
  cleanupBlobs: mockCleanupBlobs,
}));

jest.unstable_mockModule('../utils/getAllObjects', () => ({
  getAllObjects: (...args: any[]) => mockGetAllObjects(...args),
}));

jest.unstable_mockModule('../utils/suiRetry', () => ({
  getCreatedObjectIds: mockGetCreatedObjectIds,
  runTx: mockRunTx,
}));

let collectResourceEntries: typeof import('./deploySite').collectResourceEntries;
let deploySite: typeof import('./deploySite').deploySite;
let planSiteTransactions: typeof import('./deploySite').planSiteTransactions;
let selectCleanupCandidates: typeof import('./deploySite').selectCleanupCandidates;

beforeAll(async () => {
  const deploySiteModule = await import('./deploySite');
  collectResourceEntries = deploySiteModule.collectResourceEntries;
  deploySite = deploySiteModule.deploySite;
  planSiteTransactions = deploySiteModule.planSiteTransactions;
  selectCleanupCandidates = deploySiteModule.selectCleanupCandidates;
});

beforeEach(() => {
  mockCleanupBlobs.mockReset();
  mockCleanupBlobs.mockResolvedValue(undefined);
  mockGetAllObjects.mockReset();
  mockGetCreatedObjectIds.mockReset();
  mockInfo.mockReset();
  mockRunTx.mockReset();
  mockSetFailed.mockReset();
  mockSetOutput.mockReset();
  mockWarning.mockReset();
});

const file = (name: string, hash = '1'): QuiltResourceFile => ({
  name,
  path: `/fixture${name}`,
  size: 10,
  hash,
  buffer: Buffer.from(name),
  quiltPatchInternalId: '0x0101000200',
  headers: {
    'Content-Type': name.endsWith('.html') ? 'text/html' : 'text/css',
    'Content-Encoding': 'identity',
  },
});

const blob = (blobId: string, files: QuiltResourceFile[]): BlobDictionary => ({
  [blobId]: {
    files,
    objectId: `0x${blobId.slice(-8)}`,
  } as any,
});

describe('site deployment planner', () => {
  it('keeps small create certification and site registration in one PTB', () => {
    const blobId = blobIdFromInt('101');
    const blobs = blob(blobId, [file('/index.html'), file('/style.css', '2')]);
    const plans = planSiteTransactions({
      isCreate: true,
      certBlobIds: [blobId],
      removalPaths: [],
      resources: collectResourceEntries(blobs),
      routeFiles: [file('/index.html')],
      cleanupObjectIds: [],
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      certBlobIds: [blobId],
      removalPaths: [],
      routeReset: true,
      cleanupObjectIds: [],
    });
    expect(plans[0].resources).toHaveLength(2);
    expect(plans[0].routeInserts.map(route => route.name)).toEqual(['/index.html']);
  });

  it('keeps small update certification, site mutation, and cleanup in one PTB', () => {
    const blobId = blobIdFromInt('102');
    const blobs = blob(blobId, [file('/index.html')]);
    const plans = planSiteTransactions({
      isCreate: false,
      certBlobIds: [blobId],
      removalPaths: ['/old.html'],
      resources: collectResourceEntries(blobs),
      routeFiles: [file('/index.html')],
      cleanupObjectIds: ['0xoldblob'],
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].certBlobIds).toEqual([blobId]);
    expect(plans[0].removalPaths).toEqual(['/old.html']);
    expect(plans[0].resources).toHaveLength(1);
    expect(plans[0].routeReset).toBe(true);
    expect(plans[0].cleanupObjectIds).toEqual(['0xoldblob']);
  });

  it('splits continuation PTBs before routes when resources exceed the budget', () => {
    const blobs: BlobDictionary = {};
    for (let i = 0; i < 180; i += 1) {
      const blobId = blobIdFromInt(String(2000 + i));
      blobs[blobId] = {
        files: [file(`/asset-${i}.css`, String(i + 1))],
        objectId: `0x${i}`,
      } as any;
    }

    const plans = planSiteTransactions({
      isCreate: false,
      certBlobIds: Object.keys(blobs),
      removalPaths: [],
      resources: collectResourceEntries(blobs),
      routeFiles: [],
      cleanupObjectIds: [],
    });

    expect(plans.length).toBeGreaterThan(1);
    expect(plans.slice(0, -1).every(plan => !plan.routeReset)).toBe(true);
    expect(plans.at(-1)?.routeReset).toBe(true);
    for (const plan of plans) {
      expect(plan.commandCost).toBeLessThanOrEqual(850);
      expect(plan.byteCost).toBeLessThanOrEqual(120_000);
    }
  });
});

describe('cleanup candidate selection', () => {
  it('deduplicates by old quilt blob, skips current blobs, and separates non-deletable blobs', () => {
    const currentBlobId = blobIdFromInt('3000');
    const staleBlobId = blobIdFromInt('3001');
    const nonDeletableBlobId = blobIdFromInt('3002');
    const oldCandidates: OldBlobObjectCandidate[] = [
      {
        blobId: currentBlobId,
        objectId: '0xcurrent',
        endEpoch: 9,
        deletable: true,
      },
      {
        blobId: staleBlobId,
        objectId: '0xstale-old',
        endEpoch: 5,
        deletable: true,
      },
      {
        blobId: staleBlobId,
        objectId: '0xstale-new',
        endEpoch: 7,
        deletable: true,
      },
      {
        blobId: nonDeletableBlobId,
        objectId: '0xlocked',
        endEpoch: 8,
        deletable: false,
      },
    ];

    const selection = selectCleanupCandidates(oldCandidates, new Set([currentBlobId]));

    expect(selection.deletable.map(candidate => candidate.objectId)).toEqual(['0xstale-new']);
    expect(selection.skipped.map(candidate => candidate.objectId)).toEqual(['0xlocked']);
  });

  it('prefers a deletable object over a newer non-deletable object for the same old blob', () => {
    const staleBlobId = blobIdFromInt('3003');
    const selection = selectCleanupCandidates(
      [
        {
          blobId: staleBlobId,
          objectId: '0xlocked-newer',
          endEpoch: 10,
          deletable: false,
        },
        {
          blobId: staleBlobId,
          objectId: '0xdeletable-older',
          endEpoch: 8,
          deletable: true,
        },
      ],
      new Set(),
    );

    expect(selection.deletable.map(candidate => candidate.objectId)).toEqual(['0xdeletable-older']);
    expect(selection.skipped.map(candidate => candidate.objectId)).toEqual(['0xlocked-newer']);
  });
});

describe('deploySite certification guard', () => {
  const deployWithEmptyConfirmations = (blobId: string) =>
    deploySite({
      config: {
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
      },
      suiClient: {} as any,
      walrusClient: {
        certifyBlob: jest.fn(),
      } as any,
      walrusSystem: {
        sitePackageId: '0xsitepkg',
        blobPackageId: '0xblobpkg',
      },
      blobs: {
        [blobId]: {
          ...blob(blobId, [file('/index.html')])[blobId],
          confirmations: [],
        } as any,
      },
      signingContext: {
        signer: { toSuiAddress: jest.fn() },
        finalize: jest.fn(),
      } as any,
    });

  it('fails before building a site PTB when a blob has no usable storage confirmations', async () => {
    const blobId = blobIdFromInt('4000');
    await expect(deployWithEmptyConfirmations(blobId)).rejects.toThrow(
      'Process will be terminated.',
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining(`Blob ${blobId} is missing storage confirmations for certification.`),
    );
    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        blobObjectsIds: [blob(blobId, [file('/index.html')])[blobId].objectId],
      }),
    );
  });

  it('preserves the deployment failure when cleanup after a failed site PTB also fails', async () => {
    const blobId = blobIdFromInt('4001');
    mockCleanupBlobs.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(deployWithEmptyConfirmations(blobId)).rejects.toThrow(
      'Process will be terminated.',
    );

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup after failed site deployment also failed: cleanup failed'),
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining(`Blob ${blobId} is missing storage confirmations for certification.`),
    );
  });

  it('skips cleanup for blob IDs still referenced by the existing site before a site PTB is submitted', async () => {
    const blobId = blobIdFromInt('4003');

    await expect(
      deploySite({
        config: {
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
        },
        suiClient: {} as any,
        walrusClient: {
          certifyBlob: jest.fn(),
        } as any,
        walrusSystem: {
          sitePackageId: '0xsitepkg',
          blobPackageId: '0xblobpkg',
        },
        blobs: {
          [blobId]: {
            ...blob(blobId, [file('/index.html')])[blobId],
            confirmations: [],
          } as any,
        },
        signingContext: {
          signer: { toSuiAddress: jest.fn() },
          finalize: jest.fn(),
        } as any,
        protectedBlobIds: new Set([blobId]),
      }),
    ).rejects.toThrow('Process will be terminated.');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(expect.objectContaining({ blobObjectsIds: [] }));
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('still referenced'));
  });

  it('does not clean up newly registered blobs after a site PTB has been submitted', async () => {
    const blobId = blobIdFromInt('4002');
    mockRunTx.mockImplementationOnce(async ({ onTransactionSubmitted }) => {
      onTransactionSubmitted?.();
      throw new Error('wait for submitted transaction failed');
    });

    await expect(
      deploySite({
        config: {
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
        },
        suiClient: {} as any,
        walrusClient: {
          certifyBlob: jest.fn(() => () => undefined),
        } as any,
        walrusSystem: {
          sitePackageId: '0xsitepkg',
          blobPackageId: '0xblobpkg',
        },
        blobs: {
          [blobId]: {
            ...blob(blobId, [file('/index.html')])[blobId],
            confirmations: [{}],
          } as any,
        },
        signingContext: {
          signer: { toSuiAddress: jest.fn() },
          finalize: jest.fn(),
        } as any,
      }),
    ).rejects.toThrow('Process will be terminated.');

    expect(mockCleanupBlobs).not.toHaveBeenCalled();
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('a site PTB was submitted and may still commit'),
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('wait for submitted transaction failed'),
    );
  });

  it('cleans up newly registered blobs when a site PTB fails before submission is confirmed', async () => {
    const blobId = blobIdFromInt('4005');
    mockRunTx.mockRejectedValueOnce(new Error('execute failed before submission'));

    await expect(
      deploySite({
        config: {
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
        },
        suiClient: {} as any,
        walrusClient: {
          certifyBlob: jest.fn(() => () => undefined),
        } as any,
        walrusSystem: {
          sitePackageId: '0xsitepkg',
          blobPackageId: '0xblobpkg',
        },
        blobs: {
          [blobId]: {
            ...blob(blobId, [file('/index.html')])[blobId],
            confirmations: [{}],
          } as any,
        },
        signingContext: {
          signer: { toSuiAddress: jest.fn() },
          finalize: jest.fn(),
        } as any,
      }),
    ).rejects.toThrow('Process will be terminated.');

    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      expect.objectContaining({
        blobObjectsIds: [blob(blobId, [file('/index.html')])[blobId].objectId],
      }),
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('execute failed before submission'),
    );
  });

  it('preserves the created-site extraction failure detail', async () => {
    const blobId = blobIdFromInt('4004');
    mockRunTx.mockImplementationOnce(async ({ onTransactionSubmitted }) => {
      onTransactionSubmitted?.();
      return { digest: '0xdigest', effects: {} };
    });
    mockGetCreatedObjectIds.mockReturnValueOnce(['0xnot-site']);
    mockGetAllObjects.mockResolvedValueOnce([{ objectId: '0xnot-site', type: '0xother::Object' }]);

    await expect(
      deploySite({
        config: {
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
        },
        suiClient: {} as any,
        walrusClient: {
          certifyBlob: jest.fn(() => () => undefined),
        } as any,
        walrusSystem: {
          sitePackageId: '0xsitepkg',
          blobPackageId: '0xblobpkg',
        },
        blobs: {
          [blobId]: {
            ...blob(blobId, [file('/index.html')])[blobId],
            confirmations: [{}],
          } as any,
        },
        signingContext: {
          signer: { toSuiAddress: jest.fn() },
          finalize: jest.fn(),
        } as any,
      }),
    ).rejects.toThrow('Process will be terminated.');

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Transaction 0xdigest did not create a Site object'),
    );
  });
});
