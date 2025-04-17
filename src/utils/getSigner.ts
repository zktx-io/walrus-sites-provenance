import * as core from '@actions/core';
import { Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

import { SiteConfig } from '../types';

import { GitSigner } from './gitSigner';

export const getSigner = async (config: SiteConfig): Promise<Keypair> => {
  if (process.env.GIT_SIGNER_PIN) {
    try {
      const { ephemeralAddress, secretKey, signer } = await GitSigner.CreateSigner(
        config.network,
        config.owner,
        process.env.GIT_SIGNER_PIN,
      );
      core.info(`🔐 Remote signer enabled. Open the signer UI to complete signing:`);
      core.info(`➡️  https://notary.wal.app/sign?q=${ephemeralAddress}`);
      const message = new TextEncoder().encode(JSON.stringify({ secretKey }));
      await signer.signPersonalMessage(message);
      return signer;
    } catch (error) {
      core.setFailed(`❌ Failed to create Git Signer: ${(error as Error).message}`);
      throw new Error('Process will be terminated.');
    }
  } else {
    const suiprivkey = process.env.ED25519_PRIVATE_KEY;
    if (!suiprivkey) {
      core.setFailed('❌ ED25519_PRIVATE_KEY environment variable is missing.');
      throw new Error('Process will be terminated.');
    }
    try {
      return Ed25519Keypair.fromSecretKey(suiprivkey);
    } catch (err) {
      core.setFailed(`❌ Failed to parse ED25519_PRIVATE_KEY: ${(err as Error).message}`);
      throw new Error('Process will be terminated.');
    }
  }
};
