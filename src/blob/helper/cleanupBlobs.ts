import * as core from '@actions/core';
import { Transaction } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { SiteConfig } from '../../types';
import { MAX_BLOB_CLEANUPS_PER_TX } from '../../utils/constants';
import { DeploymentSigner } from '../../utils/signingContext';
import { SuiClient } from '../../utils/suiClient';
import { runTx } from '../../utils/suiRetry';

const MAX_CLEANUP_FAILURE_MESSAGE_LENGTH = 240;

const truncateFailureMessage = (message: string): string =>
  message.length <= MAX_CLEANUP_FAILURE_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_CLEANUP_FAILURE_MESSAGE_LENGTH)}...`;

export const cleanupBlobs = async ({
  signer,
  suiClient,
  config,
  walrusClient,
  blobObjectsIds,
}: {
  signer: DeploymentSigner;
  suiClient: SuiClient;
  config: SiteConfig;
  walrusClient: WalrusClient;
  blobObjectsIds: string[];
}) => {
  const validBlobObjectIds = Array.from(
    new Set(blobObjectsIds.filter(blobObjectId => blobObjectId)),
  );
  const skipped = blobObjectsIds.length - validBlobObjectIds.length;

  if (validBlobObjectIds.length === 0) {
    core.info(
      `🗑️  No blob object IDs to delete. Requested ${blobObjectsIds.length}, skipped ${skipped}.`,
    );
    return;
  }

  let deleted = 0;
  let failed = 0;
  const failures: string[] = [];
  for (let i = 0; i < validBlobObjectIds.length; i += MAX_BLOB_CLEANUPS_PER_TX) {
    const chunk = validBlobObjectIds.slice(i, i + MAX_BLOB_CLEANUPS_PER_TX);
    const transaction = new Transaction();
    const storageObjects = chunk.map(blobObjectId =>
      transaction.add(walrusClient.deleteBlob({ blobObjectId })),
    );
    transaction.transferObjects(storageObjects, config.owner);

    const txNumber = Math.floor(i / MAX_BLOB_CLEANUPS_PER_TX) + 1;
    try {
      const { digest } = await runTx({
        suiClient,
        signer,
        transaction,
        operation: `cleanupBlobs:tx${txNumber}`,
        logger: core,
      });
      deleted += chunk.length;
      core.info(
        `🗑️  Deleted ${chunk.length} blob object(s) in cleanup batch ${txNumber}, tx digest: ${digest}`,
      );
    } catch (error) {
      failed += chunk.length;
      const message = truncateFailureMessage((error as Error).message);
      failures.push(`tx${txNumber}: ${message}`);
      core.warning(
        `Cleanup batch ${txNumber} failed for ${chunk.length} blob object(s): ${message}`,
      );
    }
  }
  core.info(
    `🗑️  Cleanup complete. Requested ${blobObjectsIds.length}, deleted ${deleted}, skipped ${skipped}, failed ${failed}.`,
  );
  if (failures.length > 0) {
    const summary = failures.slice(0, 5).join('; ');
    const suffix = failures.length > 5 ? `; and ${failures.length - 5} more` : '';
    throw new Error(`Cleanup failed for ${failed} blob object(s): ${summary}${suffix}`);
  }
};
