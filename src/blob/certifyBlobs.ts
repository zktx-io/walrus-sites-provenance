import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary, SiteConfig } from '../types';
import { MAX_CMD_CERTIFICATIONS } from '../utils/constants';

export const certifyBlobs = async ({
  config,
  suiClient,
  walrusClient,
  blobs,
  signer,
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  blobs: BlobDictionary;
  signer: Signer;
}) => {
  for (let i = 0; i < Object.keys(blobs).length; i += MAX_CMD_CERTIFICATIONS) {
    const chunk = Object.keys(blobs).slice(i, i + MAX_CMD_CERTIFICATIONS);

    const transaction = new Transaction();
    transaction.setGasBudget(config.gas_budget);

    for (const blobId of chunk) {
      transaction.add(
        await walrusClient.certifyBlob({
          blobId,
          blobObjectId: blobs[blobId].objectId,
          confirmations: blobs[blobId].confirmations!,
          deletable: true,
        }),
      );
    }

    const { digest } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction,
    });

    const receipt = await suiClient.waitForTransaction({
      digest,
      options: { showEffects: true, showEvents: true },
    });

    if (receipt.errors) {
      console.error('Transaction failed:', receipt.errors);
      throw new Error('Transaction failed');
    } else {
      console.log(`🚀 Certified ${chunk.length} blob(s), tx digest: ${digest}`);
    }
  }
};
