import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary, SiteConfig } from '../types';
import { WalrusSystem } from '../utils/loadWalrusSystem';

import { cleanupBlobs } from './helper/cleanupBlobs';
import { getCommittee } from './helper/walrus/getCommittee';
import { writeBlobHelper } from './helper/writeBlobHelper';

export const writeBlobs = async ({
  retryLimit,
  config,
  signer,
  suiClient,
  walrusClient,
  walrusSystem,
  blobs,
}: {
  retryLimit: number;
  signer: Signer;
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  walrusSystem: WalrusSystem;
  blobs: BlobDictionary;
}) => {
  try {
    const systemState = await walrusClient.systemState();
    const stakingState = await walrusClient.stakingState();
    const committee = await getCommittee(suiClient, stakingState.committee);

    const n = systemState.committee.n_shards;
    const quorum = Math.ceil((2 * n) / 3) + 1;

    for (const blobId of Object.keys(blobs)) {
      const blob = blobs[blobId];
      const confirmations = await writeBlobHelper(walrusClient, retryLimit + 1, quorum, committee, {
        blobId,
        metadata: blob.metadata,
        sliversByNode: blob.sliversByNode,
        deletable: true,
        objectId: blob.objectId,
      });
      blobs[blobId].confirmations = confirmations;
    }
  } catch (error) {
    await cleanupBlobs({
      signer,
      suiClient,
      config,
      walrusSystem,
      blobObjectsIds: Object.keys(blobs).map(blobId => blobs[blobId].objectId),
    });
    throw new Error(`🚫 Failed to write blobs: ${error}`);
  }

  return blobs;
};
