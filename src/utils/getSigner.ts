import * as core from '@actions/core';
import { Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export const getSigner = (): Keypair => {
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
};
