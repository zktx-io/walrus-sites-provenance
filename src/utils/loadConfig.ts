import fs from 'fs';
import path from 'path';

import * as core from '@actions/core';

import { SiteConfig } from '../types';

import { normalizeConfiguredSuiAddress } from './suiAddress';

export const getDefaultConfig = (): SiteConfig => ({
  network: 'testnet',
  owner: '',
  site_name: 'default-site',
  metadata: {
    link: '',
    image_url: '',
    description: '',
    project_url: '',
    creator: '',
  },
  epochs: 30,
  path: './dist',
});

const failConfig = (message: string): never => {
  core.setFailed(`❌ Invalid site.config.json: ${message}`);
  throw new Error(`Invalid site.config.json: ${message}`);
};

const validateConfig = (config: SiteConfig, raw: any): SiteConfig => {
  if (config.network !== 'mainnet' && config.network !== 'testnet') {
    failConfig('network must be "mainnet" or "testnet".');
  }

  if (!config.owner || typeof config.owner !== 'string') {
    failConfig('owner is required.');
  }
  try {
    config.owner = normalizeConfiguredSuiAddress(config.owner, 'owner');
  } catch (error) {
    failConfig(`owner must be a valid Sui address: ${(error as Error).message}`);
  }

  if (!config.site_name || typeof config.site_name !== 'string') {
    failConfig('site_name is required.');
  }

  if (!Number.isInteger(config.epochs) || config.epochs <= 0) {
    failConfig('epochs must be a positive integer.');
  }

  if (!config.path || typeof config.path !== 'string') {
    failConfig('path is required.');
  }

  if (
    config.write_retry_limit != null &&
    (!Number.isInteger(config.write_retry_limit) || config.write_retry_limit < 0)
  ) {
    failConfig('write_retry_limit must be a non-negative integer when provided.');
  }

  if (
    config.sui_grpc_timeout_ms != null &&
    (!Number.isFinite(config.sui_grpc_timeout_ms) || config.sui_grpc_timeout_ms <= 0)
  ) {
    failConfig('sui_grpc_timeout_ms must be a positive number when provided.');
  }

  if (
    config.sui_rpc_timeout_ms != null &&
    (!Number.isFinite(config.sui_rpc_timeout_ms) || config.sui_rpc_timeout_ms <= 0)
  ) {
    failConfig('sui_rpc_timeout_ms must be a positive number when provided.');
  }

  const grpcUrl = config.sui_grpc_url?.trim();
  const rpcUrl = config.sui_rpc_url?.trim();
  if (grpcUrl && rpcUrl && grpcUrl !== rpcUrl) {
    failConfig('sui_grpc_url and deprecated sui_rpc_url cannot both be set to different values.');
  }

  if (
    config.sui_grpc_timeout_ms != null &&
    config.sui_rpc_timeout_ms != null &&
    config.sui_grpc_timeout_ms !== config.sui_rpc_timeout_ms
  ) {
    failConfig(
      'sui_grpc_timeout_ms and deprecated sui_rpc_timeout_ms cannot both be set to different values.',
    );
  }

  if (raw && Object.prototype.hasOwnProperty.call(raw, 'sui_rpc_url')) {
    core.warning(
      '[walrus] sui_rpc_url is deprecated because JSON-RPC is being retired. Use sui_grpc_url for the Sui gRPC base URL.',
    );
  }

  if (raw && Object.prototype.hasOwnProperty.call(raw, 'sui_rpc_timeout_ms')) {
    core.warning('[walrus] sui_rpc_timeout_ms is deprecated. Use sui_grpc_timeout_ms.');
  }

  if (raw?.metadata && Object.prototype.hasOwnProperty.call(raw.metadata, 'name')) {
    core.warning(
      '[walrus] metadata.name is deprecated and ignored. Use top-level site_name for the site display name.',
    );
  }

  return config;
};

export const loadConfig = (): SiteConfig => {
  const resolvedPath = path.resolve('./site.config.json');

  if (!fs.existsSync(resolvedPath)) {
    failConfig(`Config file not found at ${resolvedPath}.`);
  }

  try {
    const data = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(data);
    const config = {
      ...getDefaultConfig(),
      ...parsed,
      metadata: {
        ...getDefaultConfig().metadata,
        ...(parsed.metadata || {}),
      },
    };
    return validateConfig(config, parsed);
  } catch (err) {
    if ((err as Error).message.startsWith('Invalid site.config.json:')) {
      throw err;
    }
    core.setFailed(`[walrus] Failed to load config: ${(err as Error).message}`);
    throw new Error('Process will be terminated.');
  }
};
