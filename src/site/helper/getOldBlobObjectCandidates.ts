import { blobIdFromInt, WalrusClient } from '@mysten/walrus';

import { SiteConfig } from '../../types';
import { mapWithConcurrencyLimit } from '../../utils/concurrency';
import { BLOB_OBJECT_LOOKUP_CONCURRENCY } from '../../utils/constants';
import { SuiClient, type SuiClientTypes } from '../../utils/suiClient';

import { getUsedBlobIdsFromSite } from './getUsedBlobIdsFromSite';

export interface OldBlobObjectCandidate {
  blobId: string;
  objectId: string;
  endEpoch: number;
  deletable: boolean;
}

export const getOldBlobObjectCandidates = async ({
  packageId,
  config,
  suiClient,
  walrusClient,
}: {
  packageId: string;
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
}): Promise<OldBlobObjectCandidate[]> => {
  const blobIds = await getUsedBlobIdsFromSite({
    suiClient,
    siteObjectId: config.site_obj_id!,
  });
  const usedBlobSet: Set<string> = new Set(blobIds);
  const allOwnedObjects: SuiClientTypes.Object[] = [];
  const { epoch } = (await walrusClient.systemState()).committee;
  let hasNextPage = true;
  let cursor: string | undefined = undefined;

  while (hasNextPage) {
    const page: SuiClientTypes.ListOwnedObjectsResponse = await suiClient.listOwnedObjects({
      owner: config.owner,
      type: `${packageId}::blob::Blob`,
      cursor,
      limit: 50,
    });

    allOwnedObjects.push(...page.objects);
    hasNextPage = page.hasNextPage;
    cursor = page.cursor ?? undefined;
  }
  const parsedObjects = await mapWithConcurrencyLimit(
    allOwnedObjects,
    BLOB_OBJECT_LOOKUP_CONCURRENCY,
    async obj => {
      let parsed;
      try {
        parsed = await walrusClient.getBlobObject(obj.objectId);
      } catch (error) {
        throw new Error(
          `Failed to load Walrus Blob object ${obj.objectId}: ${(error as Error).message}`,
        );
      }
      return {
        blobId: blobIdFromInt(parsed.blob_id),
        objectId: parsed.id,
        endEpoch: parsed.storage.end_epoch,
        deletable: parsed.deletable,
      };
    },
  );

  return parsedObjects.filter(obj => usedBlobSet.has(obj.blobId) && obj.endEpoch >= epoch);
};
