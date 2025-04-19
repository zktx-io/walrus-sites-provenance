import { Transaction, TransactionResult } from '@mysten/sui/transactions';

export const deleteBlobs = ({
  owner,
  packageId,
  systemObjectId,
  blobObjectsIds,
}: {
  owner: string;
  packageId: string;
  systemObjectId: string;
  blobObjectsIds: string[];
}): ((tx: Transaction) => TransactionResult) => {
  return (tx: Transaction) => {
    const result: TransactionResult[] = [];
    blobObjectsIds.forEach(id => {
      result.push(
        tx.moveCall({
          target: `${packageId}::system::delete_blob`,
          arguments: [tx.object(systemObjectId), tx.object(id)],
        }),
      );
    });
    return tx.transferObjects(result, owner);
  };
};
