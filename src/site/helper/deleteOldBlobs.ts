import { Transaction, TransactionResult } from '@mysten/sui/transactions';

export const deleteOldBlobs = ({
  owner,
  packageId,
  systemObjectId,
  oldBlobObjects,
}: {
  owner: string;
  packageId: string;
  systemObjectId: string;
  oldBlobObjects: string[];
}): ((tx: Transaction) => TransactionResult) => {
  return (tx: Transaction) => {
    const result: TransactionResult[] = [];
    oldBlobObjects.forEach(blobObjectId => {
      result.push(
        tx.moveCall({
          target: `${packageId}::system::delete_blob`,
          arguments: [tx.object(systemObjectId), tx.object(blobObjectId)],
        }),
      );
    });
    return tx.transferObjects(result, owner);
  };
};
