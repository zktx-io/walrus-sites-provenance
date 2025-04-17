import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import {
  IntentScope,
  Keypair,
  PublicKey,
  SignatureScheme,
  SignatureWithBytes,
  parseSerializedSignature,
} from '@mysten/sui/cryptography';
import { getFaucetHost, requestSuiFromFaucetV1 } from '@mysten/sui/faucet';
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { PasskeyPublicKey } from '@mysten/sui/keypairs/passkey';
import { Secp256k1PublicKey } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1PublicKey } from '@mysten/sui/keypairs/secp256r1';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

import { sleep } from '../blob/helper/writeBlobHelper';

const NETWORK = 'devnet';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

interface Payload {
  intent: IntentScope;
  network: 'testnet' | 'mainnet';
  address: string;
  bytes: string;
}

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
  const decoder = new TextDecoder();
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
  readonly #network: 'mainnet' | 'testnet';

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
    network: 'mainnet' | 'testnet',
    address: string,
    pin: string,
  ): Promise<{ ephemeralAddress: string; secretKey: string; signer: GitSigner }> {
    const ephemeralKeypair = Ed25519Keypair.generate();
    const ephemeralAddress = ephemeralKeypair.getPublicKey().toSuiAddress();
    const host = getFaucetHost(NETWORK);
    const res = await requestSuiFromFaucetV1({
      host,
      recipient: ephemeralAddress,
    });

    if (res.error) throw res.error;

    const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

    const maxRetries = 5;
    const retryDelay = 1500;
    let coinPage;

    for (let i = 0; i < maxRetries; i++) {
      await sleep(retryDelay);
      coinPage = await client.getOwnedObjects({
        owner: ephemeralAddress,
        filter: {
          StructType: '0x2::coin::Coin<0x2::sui::SUI>',
        },
        options: { showType: true, showBcs: true, showContent: true },
      });

      if (coinPage.data.length > 0) break;
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
    network: 'mainnet' | 'testnet';
    realAddress: string;
    pin: string;
    ephemeralKeypair: Ed25519Keypair;
    client: SuiClient;
  }) {
    super();
    this.#network = network;
    this.#realAddress = realAddress;
    this.#ephemeralKeypair = ephemeralKeypair;
    this.#pin = pin;
    this.#client = client;
  }

  async #verifySignature(bytes: Uint8Array, serializedSignature: string): Promise<boolean> {
    try {
      const parsed = parseSerializedSignature(serializedSignature);
      let publickey: PublicKey | undefined = undefined;

      switch (parsed.signatureScheme) {
        case 'ED25519':
          publickey = new Ed25519PublicKey(parsed.publicKey);
          break;
        case 'Secp256k1':
          publickey = new Secp256k1PublicKey(parsed.publicKey);
          break;
        case 'Secp256r1':
          publickey = new Secp256r1PublicKey(parsed.publicKey);
          break;
        case 'Passkey':
          publickey = new PasskeyPublicKey(parsed.publicKey);
          break;
      }

      if (!publickey || publickey.toSuiAddress() !== this.#realAddress || !parsed.signature) {
        return false;
      }

      return publickey.verify(bytes, parsed.signature);
    } catch {
      return false;
    }
  }

  async #sendRequest(payload: Payload): Promise<SignatureWithBytes> {
    const encrypted = await encryptBytes(
      new TextEncoder().encode(JSON.stringify(payload)),
      this.#pin,
    );
    const ephemeralAddress = this.#ephemeralKeypair.getPublicKey().toSuiAddress();
    const tx = new Transaction();
    tx.setSender(ephemeralAddress);
    tx.setGasBudget(1000000);
    tx.pure.string(encrypted);
    tx.transferObjects([tx.gas], ephemeralAddress);
    const { digest: request } = await this.#client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.#ephemeralKeypair,
    });
    await this.#client.waitForTransaction({ digest: request, options: { showInput: true } });

    let retry = 20;
    const sleepTime = 5000;
    while (retry-- > 0) {
      const { data } = await this.#client.queryTransactionBlocks({
        filter: { FromAddress: ephemeralAddress },
        order: 'descending',
        options: { showInput: true },
      });
      if (data.length > 0 && data[0].digest !== request && data[0].transaction) {
        const tx = data[0].transaction.data.transaction;
        if (
          tx &&
          tx.kind === 'ProgrammableTransaction' &&
          tx.inputs.length > 0 &&
          tx.inputs[0].type === 'pure' &&
          Array.isArray(tx.inputs[0].value)
        ) {
          const decrypted = await decryptBytes(new Uint8Array(tx.inputs[0].value), this.#pin);
          const received: { intent: IntentScope; signature: string } = JSON.parse(
            new TextDecoder().decode(decrypted),
          );
          if (received.intent !== payload.intent) {
            throw new Error(
              `Unexpected intent: received ${received.intent}, expected ${payload.intent}`,
            );
          }
          const verify = await this.#verifySignature(fromBase64(payload.bytes), received.signature);
          if (!verify) {
            throw new Error(`Signature verification failed for address ${this.#realAddress}`);
          }
          return {
            bytes: payload.bytes,
            signature: received.signature,
          };
        } else {
          throw new Error(`Invalid tx type or structure: ${JSON.stringify(tx)}`);
        }
      }
      await sleep(sleepTime);
    }
    throw new Error('Timeout: transaction not found');
  }

  toSuiAddress(): string {
    return this.#realAddress;
  }

  async signTransaction(bytes: Uint8Array): Promise<SignatureWithBytes> {
    return this.#sendRequest({
      intent: 'TransactionData',
      network: this.#network,
      address: this.#realAddress,
      bytes: toBase64(bytes),
    });
  }

  async signPersonalMessage(bytes: Uint8Array): Promise<SignatureWithBytes> {
    return this.#sendRequest({
      intent: 'PersonalMessage',
      network: this.#network,
      address: this.#realAddress,
      bytes: toBase64(bytes),
    });
  }
}
