import { SliversForNode } from '@mysten/walrus';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  hash: string;
  buffer: Buffer;
  headers: {
    'Content-Type': string;
    'Content-Encoding': string;
  };
}

export interface FileGroup {
  groupId: number;
  size: number;
  files: FileInfo[];
}

interface BlobMetadata {
  V1: {
    encoding_type:
      | 'RedStuff'
      | 'RS2'
      | {
          RedStuff: boolean | object | null;
        }
      | {
          RS2: boolean | object | null;
        };
    unencoded_length: string | number | bigint;
    hashes: Iterable<{
      primary_hash: import('@mysten/bcs').EnumInputShape<{
        Empty: boolean | object | null;
        Digest: Iterable<number>;
      }>;
      secondary_hash: import('@mysten/bcs').EnumInputShape<{
        Empty: boolean | object | null;
        Digest: Iterable<number>;
      }>;
    }> & {
      length: number;
    };
  };
}

export type StorageConfirmation = {
  serializedMessage: string;
  signature: string;
};

export interface BlobData {
  files: FileInfo[];
  metadata: BlobMetadata;
  rootHash: Uint8Array<ArrayBufferLike>;
  sliversByNode: SliversForNode[];
  objectId: string;
  confirmations?: (StorageConfirmation | null)[];
}

export interface BlobDictionary {
  [blobId: string]: BlobData;
}

export interface SiteConfig {
  network: 'mainnet' | 'testnet';
  owner: string;
  site_name: string;
  metadata: {
    link: string;
    image_url: string;
    name: string;
    description: string;
    project_url: string;
    creator: string;
  };
  epochs: number;
  path: string;
  gas_budget: number;
  write_retry_limit?: number;
  site_obj_id?: string;
}
