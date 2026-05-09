import { jest } from '@jest/globals';

import type { SiteConfig } from '../types';

const mockCore = {
  warning: jest.fn<(message: string) => void>(),
  setFailed: jest.fn<(message: string) => void>(),
};
const mockGrpcWebFetchTransport = jest.fn().mockImplementation(options => ({ options }));
const mockSuiClient = jest.fn().mockImplementation(options => ({ options }));

jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('@mysten/sui/grpc', () => ({
  GrpcWebFetchTransport: mockGrpcWebFetchTransport,
}));
jest.unstable_mockModule('./suiClient', () => ({
  getFullnodeUrl: jest.fn((network: string) => `https://fullnode.${network}.sui.io:443`),
  SuiClient: mockSuiClient,
}));

let createSuiClient: typeof import('./createSuiClient').createSuiClient;

const baseConfig: SiteConfig = {
  network: 'testnet',
  owner: '0x1',
  site_name: 'fixture',
  metadata: {
    link: '',
    image_url: '',
    description: '',
    project_url: '',
    creator: '',
  },
  epochs: 1,
  path: './dist',
};

describe('createSuiClient', () => {
  beforeAll(async () => {
    ({ createSuiClient } = await import('./createSuiClient'));
  });

  beforeEach(() => {
    mockCore.warning.mockReset();
    mockCore.setFailed.mockReset();
    mockGrpcWebFetchTransport.mockClear();
    mockSuiClient.mockClear();
    delete process.env.SUI_GRPC_URL;
    delete process.env.SUI_RPC_URL;
    delete process.env.SUI_GRPC_TIMEOUT_MS;
    delete process.env.SUI_RPC_TIMEOUT_MS;
  });

  it('accepts the deprecated RPC env alias as a gRPC endpoint with a warning', () => {
    process.env.SUI_RPC_URL = 'https://fullnode.testnet.sui.io:443';

    expect(() => createSuiClient(baseConfig)).not.toThrow();
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('SUI_RPC_URL'));
  });

  it('rejects conflicting gRPC and deprecated RPC endpoint env vars', () => {
    process.env.SUI_GRPC_URL = 'https://grpc.example';
    process.env.SUI_RPC_URL = 'https://rpc.example';

    expect(() => createSuiClient(baseConfig)).toThrow('Invalid Sui client configuration');
    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('SUI_GRPC_URL and deprecated sui_rpc_url'),
    );
  });

  it('rejects invalid timeout env vars instead of silently ignoring them', () => {
    process.env.SUI_GRPC_TIMEOUT_MS = 'not-a-number';

    expect(() => createSuiClient(baseConfig)).toThrow(
      'SUI_GRPC_TIMEOUT_MS must be a positive number',
    );
    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('SUI_GRPC_TIMEOUT_MS must be a positive number'),
    );
  });

  it('passes gRPC timeout through the official transport options', () => {
    createSuiClient({
      ...baseConfig,
      sui_grpc_timeout_ms: 1234,
    });

    expect(mockGrpcWebFetchTransport).toHaveBeenCalledWith({
      baseUrl: 'https://fullnode.testnet.sui.io:443',
      timeout: 1234,
    });
    expect(mockSuiClient).toHaveBeenCalledWith({
      network: 'testnet',
      transport: { options: { baseUrl: 'https://fullnode.testnet.sui.io:443', timeout: 1234 } },
    });
  });

  it('keeps the deprecated RPC timeout alias wired to the gRPC transport', () => {
    createSuiClient({
      ...baseConfig,
      sui_rpc_timeout_ms: 5678,
    });

    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('SUI_RPC_TIMEOUT_MS'));
    expect(mockGrpcWebFetchTransport).toHaveBeenCalledWith({
      baseUrl: 'https://fullnode.testnet.sui.io:443',
      timeout: 5678,
    });
  });
});
