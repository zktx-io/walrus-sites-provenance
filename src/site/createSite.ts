import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

import { BlobDictionary, SiteConfig } from '../types';
import { failWithMessage } from '../utils/failWithMessage';
import { getAllObjects } from '../utils/getAllObjects';
import { GitSigner } from '../utils/gitSigner';
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
  isGitSigner,
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusSystem: WalrusSystem;
  blobs: BlobDictionary;
  signer: Signer;
  isGitSigner: boolean;
}) => {
  const transaction = new Transaction();

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

  // dry run transaction to estimate gas
  transaction.setSender(signer.toSuiAddress());
  const { input } = await suiClient.dryRunTransactionBlock({
    transactionBlock: await transaction.build({ client: suiClient }),
  });
  transaction.setGasBudget(parseInt(input.gasData.budget));

  // Execute transaction
  const { digest } = await suiClient.signAndExecuteTransaction({
    signer,
    transaction,
  });

  const { effects } = await suiClient.waitForTransaction({
    digest,
    options: { showEffects: true },
  });

  const txCreatedIds = effects!.created?.map(e => e.reference.objectId) ?? [];

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
  if (effects!.status.status !== 'success' || suiSiteObjects.length === 0) {
    failWithMessage(
      `Transaction ${digest} is ${effects!.status.status}: ${JSON.stringify(effects!.status.error)}`,
    );
  } else {
    siteObjectId = suiSiteObjects[0].data?.objectId || '';
    core.info(`🚀 Site created successfully, tx digest: ${digest}`);
  }

  if (batchedCommands.length > 1) {
    const tx = new Transaction();
    batchedCommands
      .slice(1)
      .forEach(batch =>
        batch.forEach(option => tx.add(registerResources({ ...option, site: siteObjectId }))),
      );

    // dry run transaction to estimate gas
    tx.setSender(signer.toSuiAddress());
    const { input: input2 } = await suiClient.dryRunTransactionBlock({
      transactionBlock: await tx.build({ client: suiClient }),
    });
    tx.setGasBudget(parseInt(input2.gasData.budget));

    const { digest: digest2 } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
    });
    const { effects: effects2 } = await suiClient.waitForTransaction({
      digest: digest2,
      options: { showEffects: true },
    });
    if (effects2!.status.status !== 'success' || suiSiteObjects.length === 0) {
      failWithMessage(
        `Transaction ${digest2} is ${effects2!.status.status}: ${JSON.stringify(effects2!.status.error)}`,
      );
    } else {
      core.info(`🚀 Add Resurces successfully, tx digest: ${digest2}`);
    }
  }

  const b36 = hexToBase36(siteObjectId);
  if (config.network === 'mainnet') {
    const url = `http://${b36}.wal.app`;
    core.info(`\n🌐 ${url}`);
    core.info(`⚠️ To perform upgrades later, add this to your site.config.json:`);
    core.info(`  "site_obj_id": "${siteObjectId}"`);
    if (isGitSigner) {
      const message = new TextEncoder().encode(JSON.stringify({ url }));
      await (signer as GitSigner).signPersonalMessage(message, true);
    }
  } else {
    const url = `http://${b36}.localhost:3000`;
    core.info(`\n🌐 ${url}`);
    core.info(`👉 You can test this Walrus Site locally.`);
    if (isGitSigner) {
      const message = new TextEncoder().encode(JSON.stringify({ url }));
      await (signer as GitSigner).signPersonalMessage(message, true);
    }
  }
};
