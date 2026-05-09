import fs from 'fs';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';

const mockCore = {
  warning: jest.fn<(message: string) => void>(),
  setFailed: jest.fn<(message: string) => void>(),
};

jest.unstable_mockModule('@actions/core', () => mockCore);

let loadConfig: typeof import('./loadConfig').loadConfig;

describe('loadConfig', () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeAll(async () => {
    ({ loadConfig } = await import('./loadConfig'));
  });

  beforeEach(() => {
    mockCore.warning.mockReset();
    mockCore.setFailed.mockReset();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walrus-config-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates required site config and warns for deprecated metadata.name', () => {
    fs.writeFileSync(
      path.join(tempDir, 'site.config.json'),
      JSON.stringify({
        network: 'testnet',
        owner: '0x1',
        site_name: 'fixture',
        epochs: 1,
        path: './dist',
        sui_rpc_url: 'https://fullnode.testnet.sui.io:443',
        sui_rpc_timeout_ms: 30000,
        metadata: {
          name: 'ignored',
          description: 'fixture site',
        },
      }),
    );

    const config = loadConfig();

    expect(config.site_name).toBe('fixture');
    expect(config.owner).toBe('0x0000000000000000000000000000000000000000000000000000000000000001');
    expect(config.metadata.description).toBe('fixture site');
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('metadata.name is deprecated'),
    );
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('sui_rpc_url is deprecated'),
    );
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('sui_rpc_timeout_ms is deprecated'),
    );
  });

  it('fails when site.config.json is missing', () => {
    expect(() => loadConfig()).toThrow('Invalid site.config.json');
  });

  it('rejects conflicting gRPC and deprecated RPC aliases', () => {
    fs.writeFileSync(
      path.join(tempDir, 'site.config.json'),
      JSON.stringify({
        network: 'testnet',
        owner: '0x1',
        site_name: 'fixture',
        epochs: 1,
        path: './dist',
        sui_grpc_url: 'https://grpc.example',
        sui_rpc_url: 'https://rpc.example',
      }),
    );

    expect(() => loadConfig()).toThrow('sui_grpc_url and deprecated sui_rpc_url');
    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('sui_grpc_url and deprecated sui_rpc_url'),
    );
  });

  it('rejects invalid owner addresses before deployment work starts', () => {
    fs.writeFileSync(
      path.join(tempDir, 'site.config.json'),
      JSON.stringify({
        network: 'testnet',
        owner: 'not-a-sui-address',
        site_name: 'fixture',
        epochs: 1,
        path: './dist',
      }),
    );

    expect(() => loadConfig()).toThrow('owner must be a valid Sui address');
    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('owner must be a valid Sui address'),
    );
  });
});
