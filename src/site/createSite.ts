import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

import { BlobDictionary, SiteConfig } from '../types';
import { failWithMessage } from '../utils/failWithMessage';
import { getAllObjects } from '../utils/getAllObjects';
import { hexToBase36 } from '../utils/hexToBase36';
import { WalrusSystem } from '../utils/loadWalrusSystem';

import { addRoutes } from './helper/addRoutes';
import { generateBatchedResourceCommands } from './helper/generateBatchedResourceCommands';
import { registerResources, RegisterResourcesOption } from './helper/registerResources';

export const createSite = async ({
  config,
  suiClient,
  walrusSystem,
  blobs,
  signer,
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusSystem: WalrusSystem;
  blobs: BlobDictionary;
  signer: Signer;
}) => {
  const transaction = new Transaction();
  transaction.setGasBudget(config.gas_budget);

  // Create metadata object
  const metadata = transaction.moveCall({
    target: `${walrusSystem.sitePackageId}::metadata::new_metadata`,
    arguments: [
      transaction.pure.option('string', config.metadata.link || null),
      transaction.pure.option('string', config.metadata.image_url || null),
      transaction.pure.option('string', config.metadata.description || null),
      transaction.pure.option('string', config.metadata.project_url || null),
      transaction.pure.option('string', config.metadata.creator || null),
    ],
  });

  // Create site object
  const site = transaction.moveCall({
    target: `${walrusSystem.sitePackageId}::site::new_site`,
    arguments: [transaction.pure.string(config.site_name), metadata],
  });

  // Register resources for each file
  const batchedCommands: RegisterResourcesOption[][] = generateBatchedResourceCommands({
    blobs,
    packageId: walrusSystem.sitePackageId,
    site,
  });

  if (batchedCommands.length === 0) {
    throw new Error('No resources to register');
  }

  batchedCommands[0].forEach(option => transaction.add(registerResources(option)));

  transaction.add(
    addRoutes({ packageId: walrusSystem.sitePackageId, site, blobs, isUpdate: false }),
  );

  // Transfer site to owner
  transaction.transferObjects([site], config.owner);

  // Execute transaction
  const { digest } = await suiClient.signAndExecuteTransaction({
    signer,
    transaction,
  });

  const receipt = await suiClient.waitForTransaction({
    digest,
    options: { showEffects: true, showEvents: true },
  });

  const txCreatedIds = receipt.effects?.created?.map(e => e.reference.objectId) ?? [];

  const createdObjects = await getAllObjects(suiClient, {
    ids: txCreatedIds,
    options: { showType: true, showBcs: true },
  });

  const suiSiteObjects = createdObjects.filter(
    obj =>
      obj.data?.type === `${walrusSystem.sitePackageId}::site::Site` &&
      obj.data?.bcs?.dataType === 'moveObject',
  );

  // Log created site object IDs
  let siteObjectId = '';
  if (receipt.errors || suiSiteObjects.length === 0) {
    failWithMessage(`❌ Create site failed: ${JSON.stringify(receipt.errors)}`);
  } else {
    siteObjectId = suiSiteObjects[0].data?.objectId || '';
    core.info(`🚀 Site created successfully, tx digest: ${digest}`);
  }

  if (batchedCommands.length > 1) {
    const tx = new Transaction();
    tx.setGasBudget(config.gas_budget);
    batchedCommands
      .slice(1)
      .forEach(batch =>
        batch.forEach(option => tx.add(registerResources({ ...option, site: siteObjectId }))),
      );
    const { digest: digest2 } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
    });
    const receipt2 = await suiClient.waitForTransaction({
      digest: digest2,
      options: { showEffects: true, showEvents: true },
    });
    core.info(`🚀 Add Resurces successfully, tx digest: ${digest2}`);
  }

  const b36 = hexToBase36(siteObjectId);
  core.info(`\n📦 Site object ID: ${siteObjectId}`);
  if (config.network === 'mainnet') {
    core.info(`🌐 https://${b36}.wal.app/`);
    core.info(`👉 You can now register this site on SuiNS using the object ID above.`);
  } else {
    core.info(`🌐 http://${b36}.localhost:3000/`);
    core.info(`👉 You can test this Walrus Site locally.`);
  }
};
