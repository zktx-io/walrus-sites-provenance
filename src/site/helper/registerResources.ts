import { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { blobIdToInt } from '@mysten/walrus';

import { QUILT_PATCH_ID_INTERNAL_HEADER } from '../../blob/helper/quiltPatchInternalId';
import { QuiltResourceFile } from '../../types';

export interface RegisterResourcesOption {
  packageId: string;
  site: TransactionResult | string;
  file: QuiltResourceFile;
  blobId: string;
}

export const registerResources = ({
  packageId,
  site,
  file,
  blobId,
}: RegisterResourcesOption): ((transaction: Transaction) => TransactionResult) => {
  return (transaction: Transaction) => {
    if (!file.quiltPatchInternalId) {
      throw new Error(`Resource ${file.name} is missing a quilt patch internal ID`);
    }

    const range = transaction.moveCall({
      target: `${packageId}::site::new_range_option`,
      arguments: [transaction.pure.option('u64', null), transaction.pure.option('u64', null)],
    });

    const newResource = transaction.moveCall({
      target: `${packageId}::site::new_resource`,
      arguments: [
        transaction.pure.string(file.name),
        transaction.pure.u256(blobIdToInt(blobId)),
        transaction.pure.u256(file.hash),
        range,
      ],
    });

    transaction.moveCall({
      target: `${packageId}::site::add_header`,
      arguments: [
        newResource,
        transaction.pure.string('content-encoding'),
        transaction.pure.string(file.headers['Content-Encoding'] || 'identity'),
      ],
    });

    transaction.moveCall({
      target: `${packageId}::site::add_header`,
      arguments: [
        newResource,
        transaction.pure.string('content-type'),
        transaction.pure.string(file.headers['Content-Type']),
      ],
    });

    transaction.moveCall({
      target: `${packageId}::site::add_header`,
      arguments: [
        newResource,
        transaction.pure.string(QUILT_PATCH_ID_INTERNAL_HEADER),
        transaction.pure.string(file.quiltPatchInternalId),
      ],
    });

    return transaction.moveCall({
      target: `${packageId}::site::add_resource`,
      arguments: [typeof site === 'string' ? transaction.object(site) : site, newResource],
    });
  };
};
