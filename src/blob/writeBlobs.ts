import { SuiClient } from '@mysten/sui/client';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary } from '../types';

import { getCommittee } from './helper/walrus/getCommittee';
import { writeBlobHelper } from './helper/writeBlobHelper';

export const writeBlobs = async ({
  retryLimit,
  suiClient,
  walrusClient,
  blobs,
}: {
  retryLimit: number;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  blobs: BlobDictionary;
}) => {
  const systemState = await walrusClient.systemState();
  const stakingState = await walrusClient.stakingState();
  const committee = await getCommittee(suiClient, stakingState.committee);

  const quorum =
    systemState.committee.n_shards - Math.floor((systemState.committee.n_shards - 1) / 4);

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

  return blobs;
};
