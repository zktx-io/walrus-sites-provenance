import { fromBase64 } from '@mysten/bcs';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { blobIdFromInt } from '@mysten/walrus';

import { QUILT_PATCH_ID_INTERNAL_HEADER } from '../../blob/helper/quiltPatchInternalId';
import { BlobDictionary, QuiltResourceFile, RawResourceFile } from '../../types';

import { registerResources } from './registerResources';

const packageId = '0x00000000000000000000000000000000000000000000000000000000000000aa';
const siteObjectId = '0x00000000000000000000000000000000000000000000000000000000000000bb';

const file = (name: string, size: number, hash: string): QuiltResourceFile => ({
  name,
  path: `/fixture${name}`,
  size,
  hash,
  buffer: Buffer.from(name),
  storageKind: 'quilt',
  quiltPatchInternalId: '0x0101000200',
  headers: {
    'Content-Type': name.endsWith('.html') ? 'text/html' : 'text/css',
    'Content-Encoding': 'identity',
  },
});

const rawFile = (name: string, size: number, hash: string): RawResourceFile => ({
  name,
  path: `/fixture${name}`,
  size,
  hash,
  buffer: Buffer.from(name),
  storageKind: 'raw',
  headers: {
    'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
    'Content-Encoding': 'identity',
  },
});

const resourceTransactionFor = (blobs: BlobDictionary): Transaction => {
  const transaction = new Transaction();
  for (const [blobId, blob] of Object.entries(blobs)) {
    for (const resourceFile of blob.files) {
      transaction.add(
        registerResources({
          packageId,
          site: siteObjectId,
          file: resourceFile,
          blobId,
        }),
      );
    }
  }

  return transaction;
};

const commandTargetsFor = (blobs: BlobDictionary): string[] => {
  return resourceTransactionFor(blobs)
    .getData()
    .commands.map(command => {
      if (command.$kind !== 'MoveCall') return command.$kind;
      const moveCall = command.MoveCall;
      return `${moveCall.package}::${moveCall.module}::${moveCall.function}`;
    });
};

const pureStringInputsFor = (transaction: Transaction): string[] => {
  return transaction.getData().inputs.flatMap(input => {
    if (input.$kind !== 'Pure') return [];
    try {
      return [bcs.string().parse(fromBase64(input.Pure.bytes))];
    } catch {
      return [];
    }
  });
};

describe('site PTB resource registration shape', () => {
  it('registers quilt resources with patch headers and no byte ranges', () => {
    const blobId = blobIdFromInt('123');
    const blobs: BlobDictionary = {
      [blobId]: {
        files: [
          { ...file('/index.html', 5, '1'), quiltPatchInternalId: '0x0101000200' },
          { ...file('/style.css', 3, '2'), quiltPatchInternalId: '0x0103000400' },
        ],
      } as any,
    };
    expect(
      blobs[blobId].files.map(resourceFile => ({
        name: resourceFile.name,
        quiltPatchInternalId: resourceFile.quiltPatchInternalId,
      })),
    ).toEqual([
      { name: '/index.html', quiltPatchInternalId: '0x0101000200' },
      { name: '/style.css', quiltPatchInternalId: '0x0103000400' },
    ]);
    const pureStrings = pureStringInputsFor(resourceTransactionFor(blobs));
    expect(pureStrings).toContain(QUILT_PATCH_ID_INTERNAL_HEADER);
    expect(pureStrings).toContain('0x0101000200');
    expect(pureStrings).toContain('0x0103000400');

    expect(commandTargetsFor(blobs)).toEqual([
      `${packageId}::site::new_range_option`,
      `${packageId}::site::new_resource`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_resource`,
      `${packageId}::site::new_range_option`,
      `${packageId}::site::new_resource`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_resource`,
    ]);
  });

  it('keeps the single-file quilt path on the same no-range resource shape', () => {
    const blobId = blobIdFromInt('456');
    const blobs: BlobDictionary = {
      [blobId]: {
        files: [file('/index.html', 5, '1')],
      } as any,
    };
    expect(blobs[blobId].files).toHaveLength(1);
    expect(commandTargetsFor(blobs)).toEqual([
      `${packageId}::site::new_range_option`,
      `${packageId}::site::new_resource`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_resource`,
    ]);
  });

  it('registers raw resources without quilt patch headers', () => {
    const blobId = blobIdFromInt('457');
    const blobs: BlobDictionary = {
      [blobId]: {
        storageKind: 'raw',
        files: [rawFile('/assets/app.js', 300_000, '3')],
      } as any,
    };
    const pureStrings = pureStringInputsFor(resourceTransactionFor(blobs));

    expect(pureStrings).not.toContain(QUILT_PATCH_ID_INTERNAL_HEADER);
    expect(commandTargetsFor(blobs)).toEqual([
      `${packageId}::site::new_range_option`,
      `${packageId}::site::new_resource`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_header`,
      `${packageId}::site::add_resource`,
    ]);
  });

  it('supports transaction-result site references and default content encoding', () => {
    const blobId = blobIdFromInt('789');
    const resourceFile = {
      ...file('/index.html', 5, '1'),
      headers: {
        'Content-Type': 'text/html',
        'Content-Encoding': '',
      },
    };
    const transaction = new Transaction();
    const [site] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);

    transaction.add(
      registerResources({
        packageId,
        site,
        file: resourceFile,
        blobId,
      }),
    );

    expect(
      transaction.getData().commands.filter(command => command.$kind === 'MoveCall'),
    ).toHaveLength(6);
  });

  it('fails clearly when a resource has no quilt patch internal ID', () => {
    const blobId = blobIdFromInt('790');
    const resourceFile = {
      ...file('/index.html', 5, '1'),
      quiltPatchInternalId: undefined,
    };
    const transaction = new Transaction();

    expect(() =>
      transaction.add(
        registerResources({
          packageId,
          site: siteObjectId,
          file: resourceFile as any,
          blobId,
        }),
      ),
    ).toThrow('missing a quilt patch internal ID');
  });
});
