import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { WalrusClient, WriteEncodedBlobToNodesOptions } from '@mysten/walrus';

import { StorageConfirmation } from '../../types';
import { failWithMessage } from '../../utils/failWithMessage';

import { getCommittee } from './walrus/getCommittee';

const batchSize = 10;

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const writeBlobHelper = async (
  suiClient: SuiClient,
  walrusClient: WalrusClient,
  retryLimit: number,
  { blobId, metadata, sliversByNode, signal, ...options }: WriteEncodedBlobToNodesOptions,
): Promise<(StorageConfirmation | null)[]> => {
  const systemState = await walrusClient.systemState();
  const stakingState = await walrusClient.stakingState();
  const committee = await getCommittee(suiClient, stakingState.committee);

  const n = systemState.committee.n_shards;
  const quorum = Math.ceil((3 * n) / 4);

  let successfulShardCount = 0;
  const confirmations: (StorageConfirmation | null)[] = new Array(sliversByNode.length).fill(null);
  const pending = Array.from({ length: sliversByNode.length }, (_, i) => i);

  const uploadBatch = async (nodeIndices: number[]) => {
    const results = await Promise.all(
      nodeIndices.map(async i => {
        try {
          const confirmation = await walrusClient.writeEncodedBlobToNode({
            blobId,
            nodeIndex: i,
            metadata,
            slivers: sliversByNode[i],
            signal,
            ...options,
          });
          confirmations[i] = confirmation;
          successfulShardCount += committee.nodes[i].shardIndices.length;
          return null;
        } catch (e) {
          return i;
        }
      }),
    );

    return results.filter((i): i is number => i !== null);
  };

  const retryFailures = async (failures: number[]) => {
    const stillFailing: number[] = [];

    for (let i = 0; i < failures.length; i += batchSize) {
      const batch = failures.slice(i, i + batchSize);
      const failed = await uploadBatch(batch);
      stillFailing.push(...failed);
    }

    return stillFailing;
  };

  // Initial attempt
  let failures: number[] = [];
  while (pending.length > 0 && successfulShardCount < quorum) {
    const batch = pending.splice(0, batchSize);
    const failedInBatch = await uploadBatch(batch);
    failures.push(...failedInBatch);
  }

  // Retry if needed
  let attempt = 1;
  while (failures.length > 0 && successfulShardCount < quorum && attempt <= retryLimit) {
    core.warning(`🔁 Retry attempt ${attempt} for ${failures.length} nodes`);
    await sleep(10000);

    failures = await retryFailures(failures);
    attempt++;
  }

  if (successfulShardCount < quorum) {
    failWithMessage(
      `❌ Failed to store blob ${blobId}: quorum not reached (${successfulShardCount}/${quorum})`,
    );
  }

  core.info(`✅ Storing resource on Walrus: ${blobId}`);
  return confirmations;
};
