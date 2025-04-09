import * as core from '@actions/core';
import { WalrusClient, RetryableWalrusClientError } from '@mysten/walrus';
import { BlobDictionary, StorageConfirmation } from '../types';
import { failWithMessage } from '../utils/failWithMessage';
import { writeBlobHelper } from './helper/writeBlobHelper';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const writeBlobs = async ({
  retryLimit,
  walrusClient,
  blobs,
}: {
  retryLimit: number;
  walrusClient: WalrusClient;
  blobs: BlobDictionary;
}) => {
  for (const blobId of Object.keys(blobs)) {
    const blob = blobs[blobId];

    let success = false;
    let attempt = 0;
    let confirmations: (StorageConfirmation | null)[] = [];

    while (!success && attempt < retryLimit) {
      try {
        confirmations = await writeBlobHelper(walrusClient, {
          blobId,
          metadata: blob.metadata,
          sliversByNode: blob.sliversByNode,
          deletable: true,
          objectId: blob.objectId,
        });
        success = true;
      } catch (error) {
        attempt++;
        console.warn(`⚠️ Write failed for ${blobId} (attempt ${attempt})`);

        if (error instanceof RetryableWalrusClientError) {
          core.info('↩️ Resetting walrus client...');
          walrusClient.reset();
          await sleep(10000); // Wait for 1 second before retrying
        } else {
          throw error; // Non-retryable
        }
        if (attempt >= retryLimit) {
          failWithMessage(`❌ Failed to write blob ${blobId} after ${retryLimit} attempts.`);
        }
      }
    }

    for (const f of Object.keys(blobs)) {
      if (f === blobId) {
        blobs[f].confirmations = confirmations;
      }
    }

    core.info(`✅ Storing resource on Walrus: ${blobId}`);
  }

  return blobs;
};
