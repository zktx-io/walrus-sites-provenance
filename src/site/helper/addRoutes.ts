import { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { BlobDictionary } from '../../types';

export const addRoutes = ({
  packageId,
  site,
  blobs,
  remove,
}: {
  packageId: string;
  site: TransactionResult | string;
  blobs: BlobDictionary;
  remove: boolean;
}): ((tx: Transaction) => TransactionResult) => {
  return (tx: Transaction) => {
    const siteRef = typeof site === 'string' ? tx.object(site) : site;
    const transaction = new Transaction();
    if (remove) {
      transaction.moveCall({
        target: `${packageId}::site::remove_all_routes_if_exist`,
        arguments: [siteRef],
      });
    }
    let result: TransactionResult = transaction.moveCall({
      target: `${packageId}::site::create_routes`,
      arguments: [siteRef],
    });

    const htmlFiles = Object.values(blobs)
      .flatMap(blob => blob.files)
      .filter(file => file.name.endsWith('.html'));

    for (const file of htmlFiles) {
      const route = file.name === '/index.html' ? '/*' : file.name;
      result = transaction.moveCall({
        target: `${packageId}::site::insert_route`,
        arguments: [siteRef, tx.pure.string(route), tx.pure.string(file.name)],
      });
    }
    return result;
  };
};
