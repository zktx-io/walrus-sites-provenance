import { WalrusClient, WriteEncodedBlobToNodesOptions } from '@mysten/walrus';
import { StorageConfirmation } from '../../types';

export const writeBlobHelper = async (
  client: WalrusClient,
  { blobId, metadata, sliversByNode, signal, ...options }: WriteEncodedBlobToNodesOptions,
): Promise<(StorageConfirmation | null)[]> => {
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

  const confirmations: (StorageConfirmation | null)[] = [];

  for (let i = 0; i < sliversByNode.length; i++) {
    try {
      const confirmation = await client.writeEncodedBlobToNode({
        blobId,
        nodeIndex: i,
        metadata,
        slivers: sliversByNode[i],
        signal: combinedSignal,
        ...options,
      });
      confirmations.push(confirmation);
    } catch (error) {
      console.warn(`Node ${i} failed to store blob:`, error);
      confirmations.push(null);
    }
  }
  return confirmations;
};
