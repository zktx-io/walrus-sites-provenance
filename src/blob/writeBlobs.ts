import * as core from '@actions/core';
import { WalrusClient, RetryableWalrusClientError } from '@mysten/walrus';
import { BlobDictionary } from '../types';
import { failWithMessage } from '../utils/failWithMessage';

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
    let confirmations;

    while (!success && attempt < retryLimit) {
      try {
        confirmations = await walrusClient.writeEncodedBlobToNodes({
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
