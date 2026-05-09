import { createHash } from 'crypto';

import * as core from '@actions/core';
import { bcs } from '@mysten/sui/bcs';
import {
  IntentScope,
  Keypair,
  PublicKey,
  SignatureScheme,
  SignatureWithBytes,
} from '@mysten/sui/cryptography';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import { verifyPersonalMessageSignature, verifyTransactionSignature } from '@mysten/sui/verify';

import { sleep } from '../blob/helper/writeBlobHelper';
import { Network } from '../types';

import { normalizeConfiguredSuiAddress } from './suiAddress';
import { getFullnodeUrl, SuiClient, type SuiClientTypes } from './suiClient';
import {
  buildSignAndExecuteTransactionWithRetry,
  getTransactionFromResult,
  type RetryLogger,
  withSuiRetry,
} from './suiRetry';

const NETWORK = 'devnet';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const RETRY_MAX = 31;
const RETRY_DELAY = 5000;
const RESPONSE_SCAN_MAX_CHECKPOINTS = 100;

interface Payload {
  intent: IntentScope;
  network: Network;
  address: string;
  bytes: string;
}

export interface GitSignerResponseScanState {
  requestDigest: string;
  requestCheckpoint: number;
  nextCheckpoint: number;
}

const toSafeCheckpointNumber = (checkpoint: bigint | undefined, context: string): number => {
  if (checkpoint == null) {
    throw new Error(`${context} did not return a checkpoint.`);
  }

  const value = Number(checkpoint);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} returned an unsafe checkpoint value: ${checkpoint.toString()}`);
  }

  return value;
};

const getLatestCheckpointHeight = async (
  client: SuiClient,
  logger: RetryLogger,
): Promise<number> => {
  const { response: serviceInfo } = await withSuiRetry(
    async () => client.ledgerService.getServiceInfo({}),
    { operation: 'GitSigner:getServiceInfo', logger, retries: 6 },
  );

  return toSafeCheckpointNumber(serviceInfo.checkpointHeight, 'getServiceInfo');
};

const getTransactionCheckpoint = async (
  client: SuiClient,
  digest: string,
  logger: RetryLogger,
): Promise<number> => {
  const { response } = await withSuiRetry(
    async () =>
      client.ledgerService.getTransaction({
        digest,
        readMask: { paths: ['checkpoint'] },
      }),
    { operation: 'GitSigner:getRequestCheckpoint', logger, retries: 6 },
  );

  return toSafeCheckpointNumber(response.transaction?.checkpoint, `transaction ${digest}`);
};

export const createGitSignerResponseScanState = async (
  client: SuiClient,
  requestDigest: string,
  logger: RetryLogger,
): Promise<GitSignerResponseScanState> => {
  const requestCheckpoint = await getTransactionCheckpoint(client, requestDigest, logger);

  return {
    requestDigest,
    requestCheckpoint,
    nextCheckpoint: requestCheckpoint,
  };
};

export const findGitSignerResponseTransaction = async ({
  client,
  ephemeralAddress,
  scanState,
  logger,
  maxCheckpointsPerScan = RESPONSE_SCAN_MAX_CHECKPOINTS,
}: {
  client: SuiClient;
  ephemeralAddress: string;
  scanState: GitSignerResponseScanState;
  logger: RetryLogger;
  maxCheckpointsPerScan?: number;
}): Promise<SuiClientTypes.Transaction<{ transaction: true }> | null> => {
  const currentCheckpoint = await getLatestCheckpointHeight(client, logger);
  if (scanState.nextCheckpoint > currentCheckpoint) {
    return null;
  }

  const checkpointsToScan = Math.max(1, maxCheckpointsPerScan);
  const endCheckpoint = Math.min(
    currentCheckpoint,
    scanState.nextCheckpoint + checkpointsToScan - 1,
  );
  const normalizedEphemeral = normalizeSuiAddress(ephemeralAddress);

  for (
    let sequenceNumber = scanState.nextCheckpoint;
    sequenceNumber <= endCheckpoint;
    sequenceNumber++
  ) {
    const { response } = await withSuiRetry(
      async () =>
        client.ledgerService.getCheckpoint({
          checkpointId: {
            oneofKind: 'sequenceNumber',
            sequenceNumber: BigInt(sequenceNumber),
          },
          readMask: {
            paths: ['transactions.digest', 'transactions.transaction.sender'],
          },
        }),
      { operation: 'GitSigner:getCheckpoint', logger, retries: 6 },
    );

    let requestSeen = sequenceNumber !== scanState.requestCheckpoint;
    for (const transaction of response.checkpoint?.transactions ?? []) {
      const digest = transaction.digest;
      if (!digest) {
        continue;
      }

      if (digest === scanState.requestDigest) {
        requestSeen = true;
        continue;
      }

      if (!requestSeen) {
        continue;
      }

      const sender = transaction.transaction?.sender;
      if (!sender || normalizeSuiAddress(sender) !== normalizedEphemeral) {
        continue;
      }

      const result = await withSuiRetry(
        async () =>
          client.getTransaction({
            digest,
            include: { transaction: true },
          }),
        { operation: 'GitSigner:getResponseTransaction', logger, retries: 6 },
      );
      return getTransactionFromResult(result);
    }
  }

  scanState.nextCheckpoint = endCheckpoint + 1;
  return null;
};

const deriveKey = async (pin: string, salt: Uint8Array): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const encryptBytes = async (message: Uint8Array, pin: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(pin, salt);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, message),
  );

  const result = new Uint8Array(salt.length + iv.length + ciphertext.length);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(ciphertext, salt.length + iv.length);

  return toBase64(result);
};

const decryptBytes = async (encrypted: Uint8Array, pin: string): Promise<Uint8Array> => {
  const salt = encrypted.slice(0, SALT_LENGTH);
  const iv = encrypted.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const data = encrypted.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(pin, salt);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);

  return new Uint8Array(decrypted);
};

export class GitSigner extends Keypair {
  readonly #realAddress: string;
  readonly #ephemeralKeypair: Ed25519Keypair;
  readonly #pin: string;
  readonly #client: SuiClient;
  readonly #network: Network;

  sign(bytes: Uint8Array): Promise<Uint8Array> {
    throw new Error('Remote signer: sign is not implemented.');
  }

  getKeyScheme(): SignatureScheme {
    throw new Error('Remote signer: key scheme is not available');
  }

  getPublicKey(): PublicKey {
    throw new Error('Remote signer: public key is managed externally');
  }

  getSecretKey(): string {
    throw new Error('Remote signer: secret key is managed externally');
  }

  async signWithIntent(bytes: Uint8Array, intent: IntentScope): Promise<SignatureWithBytes> {
    throw new Error('Remote signer: signWithIntent is not implemented.');
  }

  static async CreateSigner(
    network: Network,
    address: string,
    pin: string,
  ): Promise<{ ephemeralAddress: string; secretKey: string; signer: GitSigner }> {
    const ephemeralKeypair = Ed25519Keypair.generate();
    const ephemeralAddress = ephemeralKeypair.getPublicKey().toSuiAddress();
    const host = getFaucetHost(NETWORK);
    const maxFaucetRetries = 5;
    let faucetResponse: Awaited<ReturnType<typeof requestSuiFromFaucetV2>> | undefined;
    let lastFaucetError: unknown;

    for (let attempt = 1; attempt <= maxFaucetRetries; attempt++) {
      try {
        faucetResponse = await requestSuiFromFaucetV2({
          host,
          recipient: ephemeralAddress,
        });

        if (faucetResponse.status === 'Success') {
          break;
        }

        lastFaucetError = faucetResponse.status;
        core.error(
          `⚠️ Devnet faucet attempt ${attempt}/${maxFaucetRetries} failed: ${JSON.stringify(faucetResponse.status)}`,
        );
      } catch (error) {
        lastFaucetError = error;
        core.error(
          `⚠️ Devnet faucet attempt ${attempt}/${maxFaucetRetries} threw: ${String(error)}`,
        );
      }

      if (attempt < maxFaucetRetries) {
        await sleep(2000);
      }
    }

    if (!faucetResponse || faucetResponse.status !== 'Success') {
      const reason = String(lastFaucetError ?? 'unknown');
      core.error(`❌ Devnet faucet request failed after ${maxFaucetRetries} attempts: ${reason}`);
      core.error('👉 Please try again in a moment.');
      throw new Error(`Failed to request devnet SUI from faucet: ${reason}`);
    }

    const client = new SuiClient({ network: NETWORK, baseUrl: getFullnodeUrl(NETWORK) });

    const maxRetries = 5;
    const retryDelay = 1500;
    let coinPage;

    for (let i = 0; i < maxRetries; i++) {
      await sleep(retryDelay);
      coinPage = await withSuiRetry(
        async () =>
          client.listOwnedObjects({
            owner: ephemeralAddress,
            type: '0x2::coin::Coin<0x2::sui::SUI>',
            include: { content: true },
          }),
        { operation: 'GitSigner.CreateSigner:listOwnedObjects', logger: core },
      );

      if (coinPage.objects.length > 0) break;
    }

    return {
      ephemeralAddress,
      secretKey: ephemeralKeypair.getSecretKey(),
      signer: new GitSigner({
        network,
        realAddress: address,
        ephemeralKeypair,
        pin,
        client,
      }),
    };
  }

  constructor({
    network,
    realAddress,
    pin,
    ephemeralKeypair,
    client,
  }: {
    network: Network;
    realAddress: string;
    pin: string;
    ephemeralKeypair: Ed25519Keypair;
    client: SuiClient;
  }) {
    super();
    this.#network = network;
    this.#realAddress = normalizeConfiguredSuiAddress(realAddress, 'GitSigner real address');
    this.#ephemeralKeypair = ephemeralKeypair;
    this.#pin = pin;
    this.#client = client;
  }

  async #verifySignature(payload: Payload, signature: string): Promise<boolean> {
    try {
      switch (payload.intent) {
        case 'TransactionData': {
          const pubKey = await verifyTransactionSignature(fromBase64(payload.bytes), signature);
          return normalizeSuiAddress(pubKey.toSuiAddress()) === this.#realAddress;
        }
        case 'PersonalMessage': {
          const needHash = new TextDecoder()
            .decode(fromBase64(payload.bytes))
            .startsWith('{"secretKey":"suiprivkey');
          const pubKey = await verifyPersonalMessageSignature(
            needHash
              ? new TextEncoder().encode(
                  toBase64(createHash('sha256').update(fromBase64(payload.bytes)).digest()),
                )
              : fromBase64(payload.bytes),
            signature,
          );
          return normalizeSuiAddress(pubKey.toSuiAddress()) === this.#realAddress;
        }
        default:
          core.setFailed(`Unknown intent: ${payload.intent}`);
          return false;
      }
    } catch {
      return false;
    }
  }

  static #splitUint8Array(input: Uint8Array, chunkSize = 16380): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < input.length; i += chunkSize) {
      chunks.push(input.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async #sendRequest(payload: Payload, isEnd?: boolean): Promise<SignatureWithBytes> {
    const encrypted = await encryptBytes(
      new TextEncoder().encode(JSON.stringify(payload)),
      this.#pin,
    );
    const chunks = GitSigner.#splitUint8Array(fromBase64(encrypted));
    const ephemeralAddress = this.#ephemeralKeypair.getPublicKey().toSuiAddress();
    const tx = new Transaction();
    tx.setSender(ephemeralAddress);
    tx.setGasBudget(10000000);
    tx.pure.bool(true);
    chunks.forEach(chunk => {
      tx.pure.vector('u8', chunk);
    });
    tx.transferObjects([tx.gas], ephemeralAddress);
    const requestResult = await buildSignAndExecuteTransactionWithRetry(
      this.#client,
      this.#ephemeralKeypair,
      tx,
      { operation: 'GitSigner:requestTx', logger: core, retries: 6 },
    );
    const request = getTransactionFromResult(requestResult).digest;
    await withSuiRetry(
      async () =>
        this.#client.waitForTransaction({ digest: request, include: { transaction: true } }),
      { operation: 'GitSigner:waitForRequestTx', logger: core, retries: 6 },
    );
    if (isEnd) {
      return {
        bytes: '',
        signature: '',
      };
    }

    const responseScanState = await createGitSignerResponseScanState(this.#client, request, core);

    let retry = RETRY_MAX;
    const sleepTime = RETRY_DELAY;
    while (retry-- > 0) {
      core.info(`⏳ Waiting for response... (${retry} retries left)`);
      const responseTransaction = await findGitSignerResponseTransaction({
        client: this.#client,
        ephemeralAddress,
        scanState: responseScanState,
        logger: core,
      });
      if (responseTransaction?.transaction) {
        const tx = responseTransaction.transaction;
        const firstInput = tx.inputs[0];
        const secondInput = tx.inputs[1];
        if (
          firstInput &&
          secondInput &&
          'Pure' in firstInput &&
          'Pure' in secondInput &&
          !bcs.Bool.parse(fromBase64(firstInput.Pure.bytes))
        ) {
          const decrypted = await decryptBytes(
            new Uint8Array(bcs.vector(bcs.u8()).parse(fromBase64(secondInput.Pure.bytes))),
            this.#pin,
          );
          const received: { intent: IntentScope; signature: string } = JSON.parse(
            new TextDecoder().decode(decrypted),
          );
          if (received.intent !== payload.intent) {
            core.setFailed(
              `Unexpected intent: received ${received.intent}, expected ${payload.intent}`,
            );
            throw new Error('Process will be terminated.');
          }
          const verify = await this.#verifySignature(payload, received.signature);
          if (!verify) {
            core.setFailed(`Signature verification failed for address ${this.#realAddress}`);
            throw new Error('Process will be terminated.');
          }
          return {
            bytes: payload.bytes,
            signature: received.signature,
          };
        } else {
          core.setFailed(`Invalid tx type or structure: ${JSON.stringify(tx)}`);
          throw new Error('Process will be terminated.');
        }
      }
      await sleep(sleepTime);
    }
    core.setFailed('Timeout: transaction not found');
    throw new Error('Process will be terminated.');
  }

  toSuiAddress(): string {
    return this.#realAddress;
  }

  async signTransaction(bytes: Uint8Array, isEnd?: boolean): Promise<SignatureWithBytes> {
    return this.#sendRequest(
      {
        intent: 'TransactionData',
        network: this.#network,
        address: this.#realAddress,
        bytes: toBase64(bytes),
      },
      isEnd,
    );
  }

  async signPersonalMessage(bytes: Uint8Array, isEnd?: boolean): Promise<SignatureWithBytes> {
    return this.#sendRequest(
      {
        intent: 'PersonalMessage',
        network: this.#network,
        address: this.#realAddress,
        bytes: toBase64(bytes),
      },
      isEnd,
    );
  }
}
