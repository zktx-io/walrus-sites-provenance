import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { WalrusClient } from '@mysten/walrus';

import { registerBlobs } from './blob/registerBlobs';
import { sleep, writeBlobs } from './blob/writeBlobs';
import { certifyBlobs } from './blob/certifyBlobs';
import { groupFilesBySize } from './blob/groupFilesBySize';
import { createSite } from './site/createSite';
import { updateSite } from './site/updateSite';

import { getWalrusSystem } from './utils/getWalrusSystem';
import { accountState } from './utils/accountState';
import { loadConfig } from './utils/loadConfig';
import { getSigner } from './utils/getSigner';

const main = async (): Promise<void> => {
  // Load configuration
  const config = loadConfig();
  const signer = getSigner();

  // Initialize Sui and Walrus clients
  const suiClient = new SuiClient({ url: getFullnodeUrl(config.network) });
  const walrusClient = new WalrusClient({
    network: config.network,
    suiClient,
  });

  const { systemObjectId, blobPackageId, walCoinType } = await getWalrusSystem(
    config.network,
    suiClient,
    walrusClient,
  );

  // Display owner address
  console.log('\nStarting Publish Walrus Site...');
  console.log(`\nNetwork: ${config.network}`);
  const walBlance = await accountState(config.owner, suiClient, walCoinType);

  // STEP 1: Load files from the specified directory
  console.log(`\n📦 Grouping files by size...`);
  const groups = groupFilesBySize(config);

  if (groups.length === 0) {
    console.log('\n🚫 No files found to upload.');
    return;
  }

  // STEP 2: Register Blob IDs
  console.log('\n📝 Registering Blobs...');
  const blobs = await registerBlobs({
    config,
    suiClient,
    walrusClient,
    walCoinType,
    groups,
    blobPackageId,
    systemObjectId,
    walBlance,
    signer,
  });

  // Wait for 3 seconds to allow for blob registration
  await sleep(3000); // Wait for 3 seconds

  // STEP 3: Write Blobs to Walrus
  console.log('\n📤 Writing blobs to nodes...');
  const blobsWithNodes = await writeBlobs({
    retryLimit: config.write_retry_limit || 5,
    walrusClient,
    blobs,
  });

  // STEP 4: Certify Blobs
  console.log('\n🛡️ Certifying Blobs...');
  await certifyBlobs({
    config,
    suiClient,
    walrusClient,
    blobs: blobsWithNodes,
    signer,
  });

  // STEP 5: Create Site with Resources
  if (config.object_id) {
    console.log('\n🛠️ Update Site with Resources...');
    await updateSite({
      config,
      suiClient,
      walrusClient,
      blobPackageId,
      blobs,
      systemObjectId,
      siteObjectId: config.object_id,
      signer,
    });
  } else {
    console.log('\n🛠️ Creating Site with Resources...');
    await createSite({
      config,
      suiClient,
      blobs: blobsWithNodes,
      signer,
    });
  }
};

main();
