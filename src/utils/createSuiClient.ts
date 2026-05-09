import * as core from '@actions/core';
import { GrpcWebFetchTransport } from '@mysten/sui/grpc';

import type { SiteConfig } from '../types';

import { getFullnodeUrl, SuiClient } from './suiClient';

const getOptionalNumberEnv = (name: string): number | undefined => {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    core.setFailed(`❌ ${name} must be a positive number when provided.`);
    throw new Error(`${name} must be a positive number when provided.`);
  }
  return parsed;
};

const failSuiClientConfig = (message: string): never => {
  core.setFailed(`❌ Invalid Sui client configuration: ${message}`);
  throw new Error(`Invalid Sui client configuration: ${message}`);
};

export const createSuiClient = (config: SiteConfig): SuiClient => {
  const explicitGrpcUrl = config.sui_grpc_url?.trim() || process.env.SUI_GRPC_URL?.trim();
  const legacyRpcUrl = config.sui_rpc_url?.trim() || process.env.SUI_RPC_URL?.trim();
  if (explicitGrpcUrl && legacyRpcUrl && explicitGrpcUrl !== legacyRpcUrl) {
    failSuiClientConfig(
      'sui_grpc_url/SUI_GRPC_URL and deprecated sui_rpc_url/SUI_RPC_URL cannot both be set to different values.',
    );
  }

  if (legacyRpcUrl && !explicitGrpcUrl) {
    core.warning(
      '[walrus] sui_rpc_url/SUI_RPC_URL is deprecated. JSON-RPC is being retired; the value is now treated as a Sui gRPC base URL. Use sui_grpc_url/SUI_GRPC_URL instead.',
    );
  }

  const baseUrl = explicitGrpcUrl || legacyRpcUrl || getFullnodeUrl(config.network);
  const grpcTimeout = config.sui_grpc_timeout_ms ?? getOptionalNumberEnv('SUI_GRPC_TIMEOUT_MS');
  const legacyRpcTimeout = config.sui_rpc_timeout_ms ?? getOptionalNumberEnv('SUI_RPC_TIMEOUT_MS');

  if (grpcTimeout != null && legacyRpcTimeout != null && grpcTimeout !== legacyRpcTimeout) {
    failSuiClientConfig(
      'sui_grpc_timeout_ms/SUI_GRPC_TIMEOUT_MS and deprecated sui_rpc_timeout_ms/SUI_RPC_TIMEOUT_MS cannot both be set to different values.',
    );
  }

  const timeout = grpcTimeout ?? legacyRpcTimeout;

  if (config.sui_rpc_timeout_ms != null || process.env.SUI_RPC_TIMEOUT_MS?.trim()) {
    core.warning(
      '[walrus] sui_rpc_timeout_ms/SUI_RPC_TIMEOUT_MS is deprecated. Use sui_grpc_timeout_ms/SUI_GRPC_TIMEOUT_MS instead.',
    );
  }

  return new SuiClient({
    network: config.network,
    transport: new GrpcWebFetchTransport({
      baseUrl,
      ...(timeout && Number.isFinite(timeout) && timeout > 0 ? { timeout } : {}),
    }),
  });
};
