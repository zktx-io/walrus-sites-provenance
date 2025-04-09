import { TransactionResult } from '@mysten/sui/transactions';
import { BlobDictionary } from '../../types';
import { RegisterResourcesOption } from './registerResources';
import { MAX_CMD_SITE_CREATE } from '../../utils/constants';

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
    let offset = 0;
    for (const file of blob.files) {
      const start = offset;
      const end = start + file.size;
      offset = end;

      resourceCommands.push({
        packageId,
        site,
        file,
        blobId,
        blob,
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
