import * as core from '@actions/core';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary, SiteConfig } from '../types';
import { DeploymentSigner } from '../utils/signingContext';
import { SuiClient } from '../utils/suiClient';

import { cleanupBlobs } from './helper/cleanupBlobs';
import { writeBlobHelper } from './helper/writeBlobHelper';

export const writeBlobs = async ({
  retryLimit,
  config,
  signer,
  suiClient,
  walrusClient,
  blobs,
  protectedBlobIds = new Set<string>(),
}: {
  retryLimit: number;
  signer: DeploymentSigner;
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  blobs: BlobDictionary;
  protectedBlobIds?: Set<string>;
}) => {
  try {
    for (const blobId of Object.keys(blobs)) {
      const blob = blobs[blobId];
      const confirmations = await writeBlobHelper(walrusClient, retryLimit, {
        blobId,
        metadata: blob.metadata,
        sliversByNode: blob.sliversByNode,
        deletable: true,
        objectId: blob.objectId,
      });
      blobs[blobId].confirmations = confirmations;
    }
  } catch (error) {
    const cleanupObjectIds: string[] = [];
    for (const [blobId, blob] of Object.entries(blobs)) {
      if (!blob.objectId) continue;
      if (protectedBlobIds.has(blobId)) {
        core.warning(
          `Skipping cleanup for newly registered Blob object ${blob.objectId} because blob ${blobId} is still referenced by the existing site.`,
        );
        continue;
      }
      cleanupObjectIds.push(blob.objectId);
    }
    try {
      await cleanupBlobs({
        signer,
        suiClient,
        config,
        walrusClient,
        blobObjectsIds: cleanupObjectIds,
      });
    } catch (cleanupError) {
      core.warning(
        `Cleanup after failed blob upload also failed: ${(cleanupError as Error).message}`,
      );
    }
    throw new Error(`🚫 Failed to write blobs: ${(error as Error).message}`);
  }

  return blobs;
};
