import * as core from '@actions/core';
import type { SignatureWithBytes } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import { SiteConfig } from '../types';

import { GitSigner } from './gitSigner';
import { normalizeConfiguredSuiAddress } from './suiAddress';

export type SigningMode = 'git-signer' | 'ed25519';

/**
 * Narrow deployment signer surface. Keep this structurally compatible with
 * Ed25519Keypair and GitSigner only; do not add Keypair-only methods here.
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

const hasDeprecationAck = (): boolean => {
  const ack = (
    core.getInput('walrus-deprecation-ack', { required: false }) ||
    process.env.WALRUS_DEPRECATION_ACK ||
    ''
  )
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes'].includes(ack);
};

export const getSigningContext = async (config: SiteConfig): Promise<SigningContext> => {
  const gitSignerPin = readSecret('git-signer-pin', 'GIT_SIGNER_PIN');
  const ed25519PrivateKey = readSecret('ed25519-private-key', 'ED25519_PRIVATE_KEY');
  // Defensive normalization for tests and future call sites that may bypass loadConfig().
  const owner = normalizeConfiguredSuiAddress(config.owner, 'owner');

  if (gitSignerPin && ed25519PrivateKey) {
    throw new Error(
      'Use exactly one signing credential: GIT_SIGNER_PIN/git-signer-pin or ED25519_PRIVATE_KEY/ed25519-private-key.',
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

  if (!ed25519PrivateKey) {
    core.setFailed('❌ Signing credential is missing.');
    throw new Error(
      'Set GIT_SIGNER_PIN/git-signer-pin or ED25519_PRIVATE_KEY/ed25519-private-key.',
    );
  }

  try {
    const signer = Ed25519Keypair.fromSecretKey(ed25519PrivateKey);
    const address = normalizeSuiAddress(signer.toSuiAddress());
    if (address !== owner) {
      throw new Error(
        `ED25519_PRIVATE_KEY address ${address} does not match site.config.json owner ${owner}.`,
      );
    }
    if (!hasDeprecationAck()) {
      core.warning(
        'ED25519_PRIVATE_KEY signing is deprecated and will be removed in v1.0.0. Use GitSigner for external signing. Set WALRUS_DEPRECATION_ACK=1 to hide this warning.',
      );
    }
    return {
      mode: 'ed25519',
      address,
      signer,
      finalize: async () => undefined,
    };
  } catch (err) {
    core.setFailed(`❌ Failed to create ED25519 signer: ${(err as Error).message}`);
    throw new Error('Process will be terminated.');
  }
};
