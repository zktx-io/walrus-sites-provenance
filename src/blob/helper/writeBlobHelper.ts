import * as core from '@actions/core';
import { WalrusClient, WriteEncodedBlobToNodesOptions } from '@mysten/walrus';

import { StorageConfirmation } from '../../types';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const writeBlobHelper = async (
  walrusClient: WalrusClient,
  retryLimit: number,
  { blobId, ...options }: WriteEncodedBlobToNodesOptions,
): Promise<(StorageConfirmation | null)[]> => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retryLimit) {
    try {
      const confirmations = await walrusClient.writeEncodedBlobToNodes({
        blobId,
        ...options,
      });
      core.info(`✅ Storing resource on Walrus: ${blobId}`);
      return confirmations;
    } catch (error) {
      lastError = error;
      attempt++;
      if (attempt > retryLimit) break;
      core.warning(`🔁 Retry attempt ${attempt} for blob ${blobId}`);
      await sleep(10000);
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const message = `❌ Failed to store blob ${blobId}: ${errorMessage}`;
  core.setFailed(message);
  throw new Error(message);
};
