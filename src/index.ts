import * as core from '@actions/core';
import { walrus } from '@mysten/walrus';

import { groupFilesBySize } from './blob/groupFilesBySize';
import { sleep } from './blob/helper/writeBlobHelper';
import { registerBlobs } from './blob/registerBlobs';
import { writeBlobs } from './blob/writeBlobs';
import { deploySite } from './site/deploySite';
import { getUsedBlobIdsFromSite } from './site/helper/getUsedBlobIdsFromSite';
import { accountState } from './utils/accountState';
import { createSuiClient } from './utils/createSuiClient';
import { failWithMessage } from './utils/failWithMessage';
import { getSigner } from './utils/getSigner';
import { loadConfig } from './utils/loadConfig';
import { loadWalrusSystem } from './utils/loadWalrusSystem';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const signingContext = await getSigner(config);

  const suiClient = createSuiClient(config);
  const walrusClient = suiClient.$extend(walrus({ name: 'walrusClient' })).walrusClient;

  const walrusSystem = await loadWalrusSystem(config.network, suiClient, walrusClient);

  core.info('\nStarting Publish Walrus Site...\n');
  const walBlance = await accountState(
    config.owner,
    config.network,
    suiClient,
    walrusSystem.walCoinType,
  );

  core.info(`\n📦 Grouping files by size...`);
  const groups = groupFilesBySize(config.path);

  if (groups.length === 0) {
    failWithMessage('🚫 No files found to upload.');
  }

  const protectedBlobIds = config.site_obj_id
    ? new Set(await getUsedBlobIdsFromSite({ suiClient, siteObjectId: config.site_obj_id }))
    : new Set<string>();

  core.info('\n📝 Registering Blobs...');
  const blobs = await registerBlobs({
    config,
    suiClient,
    walrusClient,
    walrusSystem,
    groups,
    walBlance,
    signer: signingContext.signer,
    protectedBlobIds,
  });

  await sleep(5000);

  core.info('\n📤 Writing blobs to nodes...');
  const blobsWithNodes = await writeBlobs({
    retryLimit: config.write_retry_limit ?? 5,
    signer: signingContext.signer,
    config,
    suiClient,
    walrusClient,
    blobs,
    protectedBlobIds,
  });

  core.info('\n🛡️ Certifying blobs and applying site changes...');
  await deploySite({
    config,
    suiClient,
    walrusClient,
    walrusSystem,
    blobs: blobsWithNodes,
    signingContext,
    protectedBlobIds,
  });
};

main();
