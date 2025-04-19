import * as core from '@actions/core';
import { bcs } from '@mysten/sui/bcs';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary, FileGroup, SiteConfig } from '../types';
import { base64url } from '../utils/base64url';
import { Blob } from '../utils/blob';
import { MAX_CMD_REGISTRATIONS } from '../utils/constants';
import { convert } from '../utils/convert';
import { getAllObjects } from '../utils/getAllObjects';
import { WalrusSystem } from '../utils/loadWalrusSystem';

import { encodedBlobLength } from './helper/encodedBlobLength';
import { getAllTokens } from './helper/getAllTokens';

interface Registrations {
  groupId: number;
  blobId: string;
  rootHash: Uint8Array;
  size: number;
  epochs: number;
  storageCost: bigint;
  writeCost: bigint;
  totalCost: bigint;
}
[] = [];

const blobIdToInt = (blobId: string): bigint => {
  return BigInt(bcs.u256().fromBase64(blobId.replaceAll('-', '+').replaceAll('_', '/')));
};

const buildRegistrations = async (
  walrusClient: WalrusClient,
  epochs: number,
  groups: FileGroup[], // 1 group = 1 blob
) => {
  const blobs: BlobDictionary = {};
  const registrations: Registrations[] = [];
  let totalCost = BigInt(0);

  for (let i = 0; i < groups.length; i++) {
    const { files } = groups[i];

    const buffers: Buffer[] = files.length > 1 ? [Buffer.from([0xff])] : []; // dummy byte for multiple files
    for (const file of files) {
      buffers.push(file.buffer);
    }

    const combinedBuffer = Buffer.concat(buffers);
    const { blobId, metadata, sliversByNode, rootHash } =
      await walrusClient.encodeBlob(combinedBuffer);
    const {
      storageCost,
      writeCost,
      totalCost: groupCost,
    } = await walrusClient.storageCost(combinedBuffer.length, epochs);

    blobs[blobId] = {
      objectId: '',
      files,
      metadata,
      sliversByNode,
      rootHash,
    };
    registrations.push({
      groupId: groups[i].groupId,
      blobId,
      rootHash,
      size: combinedBuffer.length,
      epochs,
      storageCost,
      writeCost,
      totalCost: groupCost,
    });
    totalCost = totalCost + groupCost;
  }
  const sortedRegistrations = registrations
    .filter(r => blobs[r.blobId])
    .sort((a, b) => (a.groupId ?? 0) - (b.groupId ?? 0));

  return { blobs, registrations: sortedRegistrations, totalCost };
};

export const registerBlobs = async ({
  config,
  suiClient,
  walrusClient,
  walrusSystem,
  groups,
  walBlance,
  signer,
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  walrusSystem: WalrusSystem;
  groups: FileGroup[];
  walBlance: bigint;
  signer: Signer;
}) => {
  const systemState = await walrusClient.systemState();

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
  } else {
    core.info(`🦭 Estimate cost: ${convert({ amount: totalCost.toString(), decimals })} WAL`);
  }

  let txIndex = 0;

  const allWalTokenIds = await getAllTokens({
    suiClient,
    owner: config.owner,
    coinType: walrusSystem.walCoinType,
  });

  for (let i = 0; i < registrations.length; i += MAX_CMD_REGISTRATIONS) {
    const chunk = registrations.slice(i, i + MAX_CMD_REGISTRATIONS);
    const transaction = new Transaction();
    const systemObject = transaction.object(walrusSystem.systemObjectId);
    transaction.setGasBudget(config.gas_budget);

    const coin = transaction.object(allWalTokenIds[0]);

    if (allWalTokenIds.length > 1) {
      transaction.mergeCoins(
        coin,
        allWalTokenIds.slice(1).map(id => transaction.object(id)),
      );
    }

    const amounts: { storageCost: bigint; writeCost: bigint }[] = chunk.map(
      ({ storageCost, writeCost }) => {
        return { storageCost, writeCost };
      },
    );
    const [...writeCoins] = transaction.splitCoins(
      coin,
      amounts.map(a => a.writeCost),
    );
    const [...storageCoins] = transaction.splitCoins(
      coin,
      amounts.map(a => a.storageCost),
    );
    const regisered: TransactionResult[] = [];
    const subsidiesObject = walrusSystem.subsidiesObjectId
      ? transaction.object(walrusSystem.subsidiesObjectId)
      : undefined;
    chunk.forEach((item, index) => {
      const storage = subsidiesObject
        ? transaction.moveCall({
            target: `${walrusSystem.subsidiesPackageId}::subsidies::reserve_space`,
            arguments: [
              subsidiesObject,
              systemObject,
              transaction.pure.u64(encodedBlobLength(item.size, systemState.committee.n_shards)),
              transaction.pure.u32(item.epochs),
              storageCoins[index],
            ],
          })
        : transaction.moveCall({
            target: `${walrusSystem.systemPackageId}::system::reserve_space`,
            arguments: [
              systemObject,
              transaction.pure.u64(encodedBlobLength(item.size, systemState.committee.n_shards)),
              transaction.pure.u32(item.epochs),
              storageCoins[index],
            ],
          });
      regisered.push(
        transaction.moveCall({
          target: `${walrusSystem.blobPackageId}::system::register_blob`,
          arguments: [
            systemObject,
            storage,
            transaction.pure.u256(blobIdToInt(item.blobId)),
            transaction.pure.u256(BigInt(bcs.u256().parse(item.rootHash))),
            transaction.pure.u64(item.size),
            transaction.pure.u8(1),
            transaction.pure.bool(true),
            writeCoins[index],
          ],
        }),
      );
    });

    transaction.transferObjects([...regisered, ...storageCoins, ...writeCoins], config.owner);

    const { digest } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction,
    });

    const { effects } = await suiClient.waitForTransaction({
      digest,
      options: { showEffects: true },
    });

    if (effects!.status.status !== 'success') {
      core.setFailed(
        `Transaction ${digest} is ${effects!.status.status}: ${JSON.stringify(effects!.status.error)}`,
      );
      throw new Error('Transaction failed');
    } else {
      const txCreatedIds = effects!.created?.map(e => e.reference.objectId) ?? [];

      const createdObjects = await getAllObjects(suiClient, {
        ids: txCreatedIds,
        options: { showType: true, showBcs: true },
      });

      const suiBlobObjects = createdObjects.filter(
        obj =>
          obj.data?.type === `${walrusSystem.blobPackageId}::blob::Blob` &&
          obj.data?.bcs?.dataType === 'moveObject',
      );

      core.info(`🚀 Transaction ${txIndex}, tx digest: ${digest}`);
      txIndex++;
      for (const obj of suiBlobObjects) {
        const parsed = Blob().fromBase64((obj.data as any).bcs.bcsBytes);
        const blobId = base64url.fromNumber(parsed.blob_id);
        blobs[blobId].objectId = parsed.id.id;
      }

      for (const { blobId, groupId } of registrations) {
        core.info(` + Blob ID: ${blobId} (Group ${groupId})`);
      }
    }
  }

  return blobs;
};
