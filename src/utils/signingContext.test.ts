import { jest } from '@jest/globals';
import type { SignatureWithBytes } from '@mysten/sui/cryptography';
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
  });

  it('rejects removed ED25519 credentials even when GitSigner is also configured', async () => {
    process.env.GIT_SIGNER_PIN = '123456';
    process.env.ED25519_PRIVATE_KEY = 'suiprivkey-removed';

    await expect(getSigningContext(baseConfig('0x1'))).rejects.toThrow(
      'ED25519_PRIVATE_KEY/ed25519-private-key signing has been removed',
    );
    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('has been removed'));
  });

  it('rejects removed ED25519 action input credentials', async () => {
    mockCore.getInput.mockImplementation((name: string) =>
      name === 'ed25519-private-key' ? 'suiprivkey-removed' : '',
    );

    await expect(getSigningContext(baseConfig('0x1'))).rejects.toThrow(
      'ED25519_PRIVATE_KEY/ed25519-private-key signing has been removed',
    );
    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('has been removed'));
  });

  it('rejects missing signing credentials', async () => {
    await expect(getSigningContext(baseConfig('0x1'))).rejects.toThrow('Set GIT_SIGNER_PIN');
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
