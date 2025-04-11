import { TransactionResult } from '@mysten/sui/transactions';

import { BlobDictionary } from '../../types';
import { MAX_CMD_SITE_CREATE } from '../../utils/constants';

import { RegisterResourcesOption } from './registerResources';

export function generateBatchedResourceCommands({
  blobs,
  packageId,
  site,
}: {
  blobs: BlobDictionary;
  packageId: string;
  site: TransactionResult | string;
}): RegisterResourcesOption[][] {
  const resourceCommands: RegisterResourcesOption[] = [];

  for (const [blobId, blob] of Object.entries(blobs)) {
    let offset = 1;
    for (const file of blob.files) {
      const start = offset;
      const end = start + (file.size - 1);
      offset = end + 1;

      resourceCommands.push({
        packageId,
        site,
        file,
        blobId,
        rangeOption:
          blob.files.length === 1
            ? undefined
            : {
                start,
                end,
              },
      });
    }
  }

  const batched: RegisterResourcesOption[][] = [];
  while (resourceCommands.length > 0) {
    batched.push(resourceCommands.splice(0, MAX_CMD_SITE_CREATE));
  }

  return batched;
}
