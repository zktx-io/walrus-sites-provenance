import * as core from '@actions/core';
import { Transaction } from '@mysten/sui/transactions';
import { blobIdFromInt, WalrusClient } from '@mysten/walrus';

import { BlobDictionary, FileGroup, ResourceStorageKind, SiteConfig } from '../types';
import { mapWithConcurrencyLimit } from '../utils/concurrency';
import { BLOB_OBJECT_LOOKUP_CONCURRENCY, MAX_BLOB_REGISTRATIONS_PER_TX } from '../utils/constants';
import { convert } from '../utils/convert';
import { getAllObjects } from '../utils/getAllObjects';
import { WalrusSystem } from '../utils/loadWalrusSystem';
import { DeploymentSigner } from '../utils/signingContext';
import { SuiClient } from '../utils/suiClient';
import { getCreatedObjectIds, runTx } from '../utils/suiRetry';

import { cleanupBlobs } from './helper/cleanupBlobs';
import { quiltPatchInternalId } from './helper/quiltPatchInternalId';

interface Registrations {
  groupId: number;
  storageKind: ResourceStorageKind;
  blobId: string;
  rootHash: Uint8Array;
  size: number;
  epochs: number;
}

const buildRegistrations = async (
  walrusClient: WalrusClient,
  epochs: number,
  groups: FileGroup[], // 1 group = 1 blob
) => {
  const blobs: BlobDictionary = {};
  const registrations: Registrations[] = [];
  let totalCost = BigInt(0);

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const { files } = group;

    if (group.storageKind === 'raw') {
      if (files.length !== 1) {
        throw new Error(`Raw blob group ${group.groupId} must contain exactly one file`);
      }

      const file = files[0];
      const { blobId, metadata, sliversByNode, rootHash } = await walrusClient.encodeBlob(
        file.buffer,
      );
      if (blobs[blobId]?.storageKind && blobs[blobId].storageKind !== 'raw') {
        throw new Error(`Blob ID ${blobId} is already registered as ${blobs[blobId].storageKind}`);
      }
      const isNewBlob = !blobs[blobId];
      if (isNewBlob) {
        blobs[blobId] = {
          storageKind: 'raw',
          objectId: '',
          files: [],
          metadata,
          sliversByNode,
          rootHash,
        };
      }
      blobs[blobId].files.push({ ...file, storageKind: 'raw' });
      if (isNewBlob) {
        const { totalCost: groupCost } = await walrusClient.storageCost(file.buffer.length, epochs);
        registrations.push({
          groupId: group.groupId,
          storageKind: 'raw',
          blobId,
          rootHash,
          size: file.buffer.length,
          epochs,
        });
        totalCost = totalCost + groupCost;
      }
      continue;
    }

    const { quilt, index } = await walrusClient.encodeQuilt({
      blobs: files.map(file => ({
        contents: file.buffer,
        identifier: file.name,
      })),
    });
    const { blobId, metadata, sliversByNode, rootHash } = await walrusClient.encodeBlob(quilt);
    if (blobs[blobId]?.storageKind && blobs[blobId].storageKind !== 'quilt') {
      throw new Error(`Blob ID ${blobId} is already registered as ${blobs[blobId].storageKind}`);
    }
    const patchIdByFileName = new Map(
      index.patches.map(patch => [
        patch.identifier,
        quiltPatchInternalId({
          startIndex: patch.startIndex,
          endIndex: patch.endIndex,
        }),
      ]),
    );
    const resourceFiles = files.map(file => {
      const patchId = patchIdByFileName.get(file.name);
      if (!patchId) {
        throw new Error(`No quilt patch found for resource ${file.name}`);
      }
      return { ...file, storageKind: 'quilt' as const, quiltPatchInternalId: patchId };
    });

    const isNewBlob = !blobs[blobId];
    if (isNewBlob) {
      blobs[blobId] = {
        storageKind: 'quilt',
        objectId: '',
        files: [],
        metadata,
        sliversByNode,
        rootHash,
      };
    }
    blobs[blobId].files.push(...resourceFiles);
    if (isNewBlob) {
      const { totalCost: groupCost } = await walrusClient.storageCost(quilt.length, epochs);
      registrations.push({
        groupId: group.groupId,
        storageKind: 'quilt',
        blobId,
        rootHash,
        size: quilt.length,
        epochs,
      });
      totalCost = totalCost + groupCost;
    }
  }
  return {
    blobs,
    registrations: registrations.sort((a, b) => (a.groupId ?? 0) - (b.groupId ?? 0)),
    totalCost,
  };
};

export const registerBlobs = async ({
  config,
  suiClient,
  walrusClient,
  walrusSystem,
  groups,
  walBlance,
  signer,
  protectedBlobIds = new Set<string>(),
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  walrusSystem: WalrusSystem;
  groups: FileGroup[];
  walBlance: bigint;
  signer: DeploymentSigner;
  protectedBlobIds?: Set<string>;
}) => {
  const { blobs, registrations, totalCost } = await buildRegistrations(
    walrusClient,
    config.epochs,
    groups,
  );

  const decimals = 9;
  if (totalCost > walBlance) {
    throw new Error(
      `Not enough WAL balance. Required: ${convert({ amount: totalCost.toString(), decimals })}, Available: ${convert({ amount: walBlance.toString(), decimals })}`,
    );
  }
  core.info(`🦭 Estimate cost: ${convert({ amount: totalCost.toString(), decimals })} WAL`);

  const registeredObjectIds = new Set<string>();
  const registeredBlobIdsByObjectId = new Map<string, string>();
  try {
    for (let i = 0; i < registrations.length; i += MAX_BLOB_REGISTRATIONS_PER_TX) {
      const chunk = registrations.slice(i, i + MAX_BLOB_REGISTRATIONS_PER_TX);
      const transaction = new Transaction();
      const registeredBlobs = chunk.map(item =>
        transaction.add(
          walrusClient.registerBlob({
            blobId: item.blobId,
            rootHash: item.rootHash,
            size: item.size,
            epochs: item.epochs,
            deletable: true,
            ...(item.storageKind === 'quilt'
              ? {
                  attributes: {
                    _walrusBlobType: 'quilt',
                  },
                }
              : {}),
          }),
        ),
      );

      transaction.transferObjects(registeredBlobs, config.owner);

      const txNumber = Math.floor(i / MAX_BLOB_REGISTRATIONS_PER_TX) + 1;
      const { digest, effects } = await runTx({
        suiClient,
        signer,
        transaction,
        operation: `registerBlobs:tx${txNumber}`,
        logger: core,
      });

      const txCreatedIds = getCreatedObjectIds(effects);
      txCreatedIds.forEach(objectId => registeredObjectIds.add(objectId));

      const createdObjects = await getAllObjects(suiClient, {
        ids: txCreatedIds,
      });

      const suiBlobObjects = createdObjects.filter(
        obj => obj.type === `${walrusSystem.blobPackageId}::blob::Blob`,
      );
      txCreatedIds.forEach(objectId => registeredObjectIds.delete(objectId));
      suiBlobObjects.forEach(obj => registeredObjectIds.add(obj.objectId));
      const parsedObjects = await mapWithConcurrencyLimit(
        suiBlobObjects,
        BLOB_OBJECT_LOOKUP_CONCURRENCY,
        async obj => {
          try {
            return {
              objectId: obj.objectId,
              parsed: await walrusClient.getBlobObject(obj.objectId),
            };
          } catch (error) {
            throw new Error(
              `Failed to load registered Walrus Blob object ${obj.objectId}: ${(error as Error).message}`,
            );
          }
        },
      );

      for (const { objectId, parsed } of parsedObjects) {
        const blobId = blobIdFromInt(parsed.blob_id);
        if (blobs[blobId]) {
          blobs[blobId].objectId = objectId;
          registeredBlobIdsByObjectId.set(objectId, blobId);
          registeredBlobIdsByObjectId.set(parsed.id, blobId);
        }
      }

      core.info(
        `🚀 Registered ${chunk.length} Walrus blob(s) in batch ${txNumber}, tx digest: ${digest}`,
      );
    }

    const missingBlobIds = registrations
      .map(item => item.blobId)
      .filter(blobId => !blobs[blobId].objectId);

    if (missingBlobIds.length > 0) {
      throw new Error(
        `Blob registration transaction(s) did not create Blob object(s) for: ${missingBlobIds.join(', ')}`,
      );
    }
  } catch (error) {
    const cleanupObjectIds = Array.from(registeredObjectIds).filter(objectId => {
      const blobId = registeredBlobIdsByObjectId.get(objectId);
      if (blobId && protectedBlobIds.has(blobId)) {
        core.warning(
          `Skipping cleanup for newly registered Blob object ${objectId} because blob ${blobId} is still referenced by the existing site.`,
        );
        return false;
      }
      return true;
    });
    if (cleanupObjectIds.length > 0) {
      try {
        await cleanupBlobs({
          signer,
          suiClient,
          config,
          walrusClient,
          blobObjectsIds: cleanupObjectIds,
        });
      } catch (cleanupError) {
        core.warning(
          `Cleanup after failed blob registration also failed: ${(cleanupError as Error).message}`,
        );
      }
    }
    throw error;
  }

  for (const item of registrations) {
    core.info(
      ` + Quilt Blob ID: ${item.blobId} (Group ${item.groupId}) -> Object ID: ${blobs[item.blobId].objectId}`,
    );
  }

  return blobs;
};
