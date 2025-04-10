import * as core from '@actions/core';
import { WalrusClient, WriteEncodedBlobToNodesOptions } from '@mysten/walrus';
import { StorageConfirmation } from '../../types';
import { failWithMessage } from '../../utils/failWithMessage';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const writeBlobHelper = async (
  walrusClient: WalrusClient,
  retryLimit: number,
  { blobId, metadata, sliversByNode, signal, ...options }: WriteEncodedBlobToNodesOptions,
): Promise<(StorageConfirmation | null)[]> => {
  const confirmations: (StorageConfirmation | null)[] = [];
  for (let i = 0; i < sliversByNode.length; i++) {
    let success = false;
    let attempt = 0;
    while (!success && attempt < retryLimit) {
      const controller = new AbortController();
      const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;
      try {
        const confirmation = await walrusClient.writeEncodedBlobToNode({
          blobId,
          nodeIndex: i,
          metadata,
          slivers: sliversByNode[i],
          signal: combinedSignal,
          ...options,
        });
        confirmations.push(confirmation);
        success = true;
      } catch (error) {
        attempt++;
        if (attempt >= retryLimit) {
          failWithMessage(`❌ Failed to write blob ${blobId} after ${retryLimit} attempts.`);
        }
        console.warn(`⚠️ Write failed for ${blobId} (attempt ${attempt})`);
        core.info('↩️ Resetting walrus client...');
        walrusClient.reset();
        await sleep(10000);
      }
    }
  }
  return confirmations;
};
