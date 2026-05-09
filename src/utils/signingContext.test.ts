import { jest } from '@jest/globals';
import type { SignatureWithBytes } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import { SiteConfig } from '../types';

const mockCore = {
  getInput: jest.fn<(name: string, options?: { required?: boolean }) => string>(),
  info: jest.fn<(message: string) => void>(),
  warning: jest.fn<(message: string) => void>(),
  setFailed: jest.fn<(message: string) => void>(),
};
const mockCreateSigner = jest.fn<(...args: unknown[]) => Promise<any>>();
let getSigningContext: typeof import('./signingContext').getSigningContext;

jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('./gitSigner', () => ({
  GitSigner: {
    CreateSigner: (...args: unknown[]) => mockCreateSigner(...args),
  },
}));

const baseConfig = (owner: string): SiteConfig => ({
  network: 'testnet',
  owner,
  site_name: 'test-site',
  metadata: {
    link: '',
    image_url: '',
    description: '',
    project_url: '',
    creator: '',
  },
  epochs: 1,
  path: './dist',
});

describe('getSigningContext', () => {
  beforeAll(async () => {
    ({ getSigningContext } = await import('./signingContext'));
  });

  beforeEach(() => {
    mockCore.getInput.mockReset();
    mockCore.getInput.mockReturnValue('');
    mockCore.info.mockReset();
    mockCore.warning.mockReset();
    mockCore.setFailed.mockReset();
    mockCreateSigner.mockReset();
    delete process.env.GIT_SIGNER_PIN;
    delete process.env.ED25519_PRIVATE_KEY;
    delete process.env['INPUT_GIT-SIGNER-PIN'];
    delete process.env['INPUT_ED25519-PRIVATE-KEY'];
    delete process.env.WALRUS_DEPRECATION_ACK;
  });

  it('keeps ED25519 mode with a deprecation warning', async () => {
    const keypair = Ed25519Keypair.generate();
    process.env.ED25519_PRIVATE_KEY = keypair.getSecretKey();

    const context = await getSigningContext(baseConfig(keypair.toSuiAddress()));

    expect(context.mode).toBe('ed25519');
    expect(context.address).toBe(keypair.toSuiAddress());
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
  });

  it('allows ED25519 deprecation warning acknowledgement for unattended CI', async () => {
    const keypair = Ed25519Keypair.generate();
    process.env.ED25519_PRIVATE_KEY = keypair.getSecretKey();
    process.env.WALRUS_DEPRECATION_ACK = '1';

    const context = await getSigningContext(baseConfig(keypair.toSuiAddress()));

    expect(context.mode).toBe('ed25519');
    expect(mockCore.warning).not.toHaveBeenCalledWith(expect.stringContaining('deprecated'));
  });

  it('rejects mixed GitSigner and ED25519 credentials', async () => {
    const keypair = Ed25519Keypair.generate();
    process.env.GIT_SIGNER_PIN = '123456';
    process.env.ED25519_PRIVATE_KEY = keypair.getSecretKey();

    await expect(getSigningContext(baseConfig(keypair.toSuiAddress()))).rejects.toThrow(
      'Use exactly one signing credential',
    );
  });

  it('rejects an ED25519 key that does not match config.owner', async () => {
    const keypair = Ed25519Keypair.generate();
    process.env.ED25519_PRIVATE_KEY = keypair.getSecretKey();

    await expect(getSigningContext(baseConfig('0x1'))).rejects.toThrow(
      'Process will be terminated.',
    );
    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('does not match'));
  });

  it('rejects missing signing credentials', async () => {
    await expect(getSigningContext(baseConfig('0x1'))).rejects.toThrow(
      'Set GIT_SIGNER_PIN/git-signer-pin or ED25519_PRIVATE_KEY/ed25519-private-key.',
    );
    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Signing credential is missing'),
    );
  });

  it('creates a GitSigner context and treats finalization as fire-and-forget', async () => {
    const owner = '0x1234';
    const normalizedOwner = normalizeSuiAddress(owner);
    const handshakeSignature: SignatureWithBytes = { bytes: 'handshake', signature: 'sig' };
    const signer = {
      toSuiAddress: jest.fn(() => owner),
      signTransaction: jest.fn<() => Promise<SignatureWithBytes>>(),
      signPersonalMessage: jest
        .fn<() => Promise<SignatureWithBytes>>()
        .mockResolvedValue(handshakeSignature),
    };
    mockCreateSigner.mockResolvedValue({
      ephemeralAddress: '0xabcd',
      secretKey: 'suiprivkey-transport-only',
      signer,
    });
    process.env.GIT_SIGNER_PIN = '123456';

    const context = await getSigningContext(baseConfig(owner));

    expect(mockCreateSigner).toHaveBeenCalledWith('testnet', normalizedOwner, '123456');
    expect(context.mode).toBe('git-signer');
    expect(context.address).toBe(normalizedOwner);
    expect(context.signer).toBe(signer);
    expect(signer.signPersonalMessage).toHaveBeenCalledTimes(1);

    signer.signPersonalMessage.mockRejectedValueOnce(new Error('devnet transport unavailable'));
    await expect(context.finalize(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    expect(signer.signPersonalMessage).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]), true);
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('GitSigner finalization notification failed'),
    );
  });
});
