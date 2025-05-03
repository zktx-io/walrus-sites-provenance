import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary, SiteConfig } from '../types';
import { MAX_CMD_CERTIFICATIONS } from '../utils/constants';
import { failWithMessage } from '../utils/failWithMessage';
import { WalrusSystem } from '../utils/loadWalrusSystem';

import { cleanupBlobs } from './helper/cleanupBlobs';

export const certifyBlobs = async ({
  config,
  suiClient,
  walrusClient,
  walrusSystem,
  blobs,
  signer,
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  walrusSystem: WalrusSystem;
  blobs: BlobDictionary;
  signer: Signer;
}) => {
  try {
    for (let i = 0; i < Object.keys(blobs).length; i += MAX_CMD_CERTIFICATIONS) {
      const chunk = Object.keys(blobs).slice(i, i + MAX_CMD_CERTIFICATIONS);

      const transaction = new Transaction();

      for (const blobId of chunk) {
        transaction.add(
          walrusClient.certifyBlob({
            blobId,
            blobObjectId: blobs[blobId].objectId,
            confirmations: blobs[blobId].confirmations!,
            deletable: true,
          }),
        );
      }

      // dry run transaction to estimate gas
      transaction.setSender(signer.toSuiAddress());
      const { input } = await suiClient.dryRunTransactionBlock({
        transactionBlock: await transaction.build({ client: suiClient }),
      });
      transaction.setGasBudget(parseInt(input.gasData.budget));

      const { digest } = await suiClient.signAndExecuteTransaction({
        signer,
        transaction,
      });

      const { effects } = await suiClient.waitForTransaction({
        digest,
        options: { showEffects: true },
      });

      if (effects!.status.status !== 'success') {
        await cleanupBlobs({
          signer,
          suiClient,
          config,
          walrusSystem,
          blobObjectsIds: Object.keys(blobs).map(blobId => blobs[blobId].objectId),
        });
        failWithMessage(
          `Transaction ${digest} is ${effects!.status.status}: ${JSON.stringify(effects!.status.error)}`,
        );
      } else {
        core.info(`🚀 Certified ${chunk.length} blob(s), tx digest: ${digest}`);
      }
    }
  } catch (error) {
    await cleanupBlobs({
      signer,
      suiClient,
      config,
      walrusSystem,
      blobObjectsIds: Object.keys(blobs).map(blobId => blobs[blobId].objectId),
    });
    failWithMessage(`🚫 Failed to certify blobs: ${error}`);
  }
};
