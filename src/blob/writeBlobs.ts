import * as core from '@actions/core';
import { WalrusClient } from '@mysten/walrus';
import { BlobDictionary } from '../types';
import { writeBlobHelper } from './helper/writeBlobHelper';

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
    const confirmations = await writeBlobHelper(walrusClient, retryLimit + 1, {
      blobId,
      metadata: blob.metadata,
      sliversByNode: blob.sliversByNode,
      deletable: true,
      objectId: blob.objectId,
    });
    blobs[blobId].confirmations = confirmations;
    core.info(`✅ Storing resource on Walrus: ${blobId}`);
  }

  return blobs;
};
