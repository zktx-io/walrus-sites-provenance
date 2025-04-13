import fs from 'fs';
import path from 'path';

import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { WalrusClient } from '@mysten/walrus';

import { groupFilesBySize } from './blob/groupFilesBySize';
import { buildRegistrations } from './blob/registerBlobs';

const main = async () => {
  const network = process.env.NETWORK ?? 'testnet';
  const epochs = Number(process.env.EPOCHS ?? '30');
  const outputDir = process.env.OUTPUT_DIR ?? './dist';

  if (network !== 'testnet' && network !== 'mainnet') {
    console.error(`❌ Invalid network "${network}". Please use "testnet" or "mainnet".`);
    return;
  }

  const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
  const walrusClient = new WalrusClient({
    network: network,
    suiClient,
  });

  const groups = groupFilesBySize(outputDir);
  const { blobs } = await buildRegistrations(walrusClient, epochs, groups);

  const resources: { path: string; blob_id: string; blob_hash: string }[] = [];

  Object.keys(blobs)
    .sort()
    .forEach(blobId => {
      blobs[blobId].files.forEach(file => {
        resources.push({
          path: file.path,
          blob_id: blobId,
          blob_hash: file.hash,
        });
      });
    });

  const outputPath = path.join(outputDir, '.well-known');
  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(
    path.join(outputPath, 'site_manifest.json'),
    JSON.stringify({ resources }, null, 2),
  );
};

main();
