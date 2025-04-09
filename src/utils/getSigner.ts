import * as core from '@actions/core';
import { Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';

export const getSigner = (): Keypair => {
  const raw = process.env.WALRUS_KEYPAIR;
  if (!raw) {
    core.setFailed('❌ WALRUS_KEYPAIR environment variable is missing.');
    throw new Error('WALRUS_KEYPAIR is not set');
  }

  try {
    return Ed25519Keypair.fromSecretKey(fromBase64(raw));
  } catch (err) {
    core.setFailed(`❌ Failed to parse WALRUS_KEYPAIR: ${(err as Error).message}`);
    throw err;
  }
};
