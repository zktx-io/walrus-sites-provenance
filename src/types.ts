import type { EnumInputShape } from '@mysten/bcs';
import { SliversForNode } from '@mysten/walrus';

export type Network = 'mainnet' | 'testnet';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  hash: string;
  buffer: Buffer;
  headers: Record<'Content-Type' | 'Content-Encoding', string>;
}

export type ResourceStorageKind = 'raw' | 'quilt';

export interface RawResourceFile extends FileInfo {
  storageKind: 'raw';
}

export interface QuiltResourceFile extends FileInfo {
  storageKind: 'quilt';
  quiltPatchInternalId: string;
}

export type ResourceFile = RawResourceFile | QuiltResourceFile;

export type FileGroup = {
  groupId: number;
  storageKind: ResourceStorageKind;
  size: number;
  files: FileInfo[];
};

type WalrusHash = EnumInputShape<{ Empty: boolean | object | null; Digest: Iterable<number> }>;
type BlobEncodingType =
  | 'RedStuff'
  | 'RS2'
  | { RedStuff: boolean | object | null }
  | { RS2: boolean | object | null };
interface BlobMetadata {
  V1: {
    encoding_type: BlobEncodingType;
    unencoded_length: string | number | bigint;
    hashes: Iterable<{ primary_hash: WalrusHash; secondary_hash: WalrusHash }> & { length: number };
  };
}

export type StorageConfirmation = { serializedMessage: string; signature: string };

export interface BlobData {
  storageKind: ResourceStorageKind;
  files: ResourceFile[];
  metadata: BlobMetadata;
  rootHash: Uint8Array<ArrayBufferLike>;
  sliversByNode: SliversForNode[];
  objectId: string;
  confirmations?: (StorageConfirmation | null)[];
}

export type BlobDictionary = Record<string, BlobData>;

export interface SiteConfig {
  network: Network;
  owner: string;
  site_name: string;
  metadata: {
    link: string;
    image_url: string;
    name?: string;
    description: string;
    project_url: string;
    creator: string;
  };
  epochs: number;
  path: string;
  write_retry_limit?: number;
  site_obj_id?: string;
  sui_grpc_url?: string;
  sui_grpc_timeout_ms?: number;
  // Deprecated v0.6.x aliases for gRPC settings.
  sui_rpc_url?: string;
  sui_rpc_timeout_ms?: number;
}
