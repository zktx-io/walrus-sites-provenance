import { SuiClient, SuiObjectResponse } from '@mysten/sui/client';
import { WalrusClient } from '@mysten/walrus';

import { SiteConfig } from '../../types';
import { base64url } from '../../utils/base64url';
import { Blob } from '../../utils/blob';

import { getUsedBlobIdsFromSite } from './getUsedBlobIdsFromSite';

export const getOldBlobObjects = async ({
  packageId,
  config,
  suiClient,
  walrusClient,
}: {
  packageId: string;
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
}): Promise<string[]> => {
  const blobIds = await getUsedBlobIdsFromSite({
    suiClient,
    siteObjectId: config.site_obj_id!,
  });
  const usedBlobSet: Set<string> = new Set(blobIds);
  const allOwnedObjects: SuiObjectResponse[] = [];
  const { epoch } = (await walrusClient.systemState()).committee;
  let hasNextPage = true;
  let cursor: string | undefined = undefined;

  while (hasNextPage) {
    const page = await suiClient.getOwnedObjects({
      owner: config.owner,
      filter: {
        StructType: `${packageId}::blob::Blob`,
      },
      options: { showType: true, showBcs: true, showContent: true },
      cursor,
      limit: 50,
    });

    allOwnedObjects.push(...page.data);
    hasNextPage = page.hasNextPage;
    cursor = page.nextCursor ?? undefined;
  }
  return allOwnedObjects
    .map(obj => {
      const parsed = Blob().fromBase64((obj.data as any).bcs.bcsBytes);
      return {
        blob_id: base64url.fromNumber(parsed.blob_id),
        id: parsed.id.id,
        end_epoch: parsed.storage.end_epoch,
      };
    })
    .filter(obj => usedBlobSet.has(obj.blob_id) && obj.end_epoch >= epoch)
    .map(obj => obj.id);
};
