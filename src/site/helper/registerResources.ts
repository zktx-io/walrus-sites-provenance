import { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { base64url } from '../../utils/base64url';
import { BlobData, FileInfo } from '../../types';

export interface RegisterResourcesOption {
  packageId: string;
  site: TransactionResult | string;
  file: FileInfo;
  blobId: string;
  blob: BlobData;
  rangeOption?: {
    start: number;
    end: number;
  };
}

export const registerResources = ({
  packageId,
  site,
  file,
  blobId,
  blob,
  rangeOption,
}: RegisterResourcesOption): ((transaction: Transaction) => TransactionResult) => {
  return (transaction: Transaction) => {
    const range = transaction.moveCall({
      target: `${packageId}::site::new_range_option`,
      arguments: [
        transaction.pure.option('u64', rangeOption ? rangeOption.start : null),
        transaction.pure.option('u64', rangeOption ? rangeOption.end : null),
      ],
    });

    // Create new resource
    const newResource = transaction.moveCall({
      target: `${packageId}::site::new_resource`,
      arguments: [
        transaction.pure.string(file.name),
        transaction.pure.u256(base64url.toNumber(blobId)),
        transaction.pure.u256(blob.blobHash),
        range,
      ],
    });

    // Add headers
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

    return transaction.moveCall({
      target: `${packageId}::site::add_resource`,
      arguments: [typeof site === 'string' ? transaction.object(site) : site, newResource],
    });
  };
};
