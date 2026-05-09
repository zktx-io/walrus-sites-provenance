import { jest } from '@jest/globals';

const mockCore = {
  info: jest.fn<(message: string) => void>(),
  setFailed: jest.fn<(message: string) => void>(),
  warning: jest.fn<(message: string) => void>(),
};

jest.unstable_mockModule('@actions/core', () => mockCore);

let writeBlobHelper: typeof import('./writeBlobHelper').writeBlobHelper;

describe('writeBlobHelper', () => {
  beforeAll(async () => {
    ({ writeBlobHelper } = await import('./writeBlobHelper'));
  });

  beforeEach(() => {
    mockCore.info.mockReset();
    mockCore.setFailed.mockReset();
    mockCore.warning.mockReset();
  });

  it('treats retryLimit as retry count, so zero means one write attempt', async () => {
    const walrusClient = {
      writeEncodedBlobToNodes: jest.fn(async () => {
        throw new Error('node write failed');
      }),
    };

    await expect(
      writeBlobHelper(walrusClient as any, 0, {
        blobId: 'blob-id',
        metadata: {} as any,
        sliversByNode: [],
        objectId: '0xblob',
        deletable: true,
      }),
    ).rejects.toThrow('node write failed');

    expect(walrusClient.writeEncodedBlobToNodes).toHaveBeenCalledTimes(1);
    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to store blob blob-id'),
    );
    expect(mockCore.warning).not.toHaveBeenCalled();
  });
});
