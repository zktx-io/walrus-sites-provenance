import * as core from '@actions/core';
import type { SignatureWithBytes } from '@mysten/sui/cryptography';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import { SiteConfig } from '../types';

import { GitSigner } from './gitSigner';
import { normalizeConfiguredSuiAddress } from './suiAddress';

export type SigningMode = 'git-signer';

/**
 * Narrow deployment signer surface. Keep this structurally compatible with GitSigner;
 * do not add Keypair-only methods here.
 */
export interface DeploymentSigner {
  toSuiAddress(): string;
  signTransaction(bytes: Uint8Array): Promise<SignatureWithBytes>;
  signPersonalMessage(bytes: Uint8Array): Promise<SignatureWithBytes>;
}

export interface SigningContext {
  mode: SigningMode;
  address: string;
  signer: DeploymentSigner;
  finalize(message: Uint8Array): Promise<void>;
}

const readSecret = (inputName: string, envName: string): string => {
  return (core.getInput(inputName, { required: false }) || process.env[envName] || '').trim();
};

export const getSigningContext = async (config: SiteConfig): Promise<SigningContext> => {
  const gitSignerPin = readSecret('git-signer-pin', 'GIT_SIGNER_PIN');
  const removedEd25519PrivateKey = readSecret('ed25519-private-key', 'ED25519_PRIVATE_KEY');
  // Defensive normalization for tests and future call sites that may bypass loadConfig().
  const owner = normalizeConfiguredSuiAddress(config.owner, 'owner');

  if (removedEd25519PrivateKey) {
    core.setFailed('❌ ED25519 private-key signing has been removed. Use GitSigner instead.');
    throw new Error(
      'ED25519_PRIVATE_KEY/ed25519-private-key signing has been removed. Set GIT_SIGNER_PIN/git-signer-pin.',
    );
  }

  if (gitSignerPin) {
    try {
      const { ephemeralAddress, secretKey, signer } = await GitSigner.CreateSigner(
        config.network,
        owner,
        gitSignerPin,
      );
      core.info('🔐 Remote signer enabled. Open the signer UI to complete signing:');
      core.info(`➡️  https://notary.wal.app/sign?q=${ephemeralAddress}`);
      const message = new TextEncoder().encode(JSON.stringify({ secretKey }));
      await signer.signPersonalMessage(message);
      return {
        mode: 'git-signer',
        address: normalizeSuiAddress(signer.toSuiAddress()),
        signer,
        finalize: async finalMessage => {
          try {
            // GitSigner finalization is a fire-and-forget notification. It does not wait for
            // or verify a signer UI response, and deployment success must not depend on it.
            await signer.signPersonalMessage(finalMessage, true);
          } catch (error) {
            core.warning(`GitSigner finalization notification failed: ${(error as Error).message}`);
          }
        },
      };
    } catch (error) {
      core.setFailed(`❌ Failed to create Git Signer: ${(error as Error).message}`);
      throw new Error('Process will be terminated.');
    }
  }

  core.setFailed('❌ Signing credential is missing.');
  throw new Error('Set GIT_SIGNER_PIN/git-signer-pin.');
};
