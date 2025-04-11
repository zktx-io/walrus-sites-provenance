import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { CommitteeInfo, WalrusClient, WriteEncodedBlobToNodesOptions } from '@mysten/walrus';

import { StorageConfirmation } from '../../types';
import { failWithMessage } from '../../utils/failWithMessage';

const batchSize = 10;

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const writeBlobHelper = async (
  walrusClient: WalrusClient,
  retryLimit: number,
  quorum: number,
  committee: CommitteeInfo,
  { blobId, metadata, sliversByNode, signal, ...options }: WriteEncodedBlobToNodesOptions,
): Promise<(StorageConfirmation | null)[]> => {
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
