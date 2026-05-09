import { bcs } from '@mysten/sui/bcs';
import { fromHex, toHex } from '@mysten/sui/utils';
import { blobIdFromInt } from '@mysten/walrus';

import { getAllObjects } from '../../utils/getAllObjects';
import { SuiClient } from '../../utils/suiClient';

import { getResourceObjects } from './getResourceObjects';

const Address = bcs.bytes(32).transform({
  input: (id: string) => fromHex(id),
  output: id => toHex(id),
});

const ResourcePathStruct = bcs.struct('ResourcePath', {
  path: bcs.string(),
});

const RangeStruct = bcs.struct('Range', {
  start: bcs.option(bcs.u64()),
  end: bcs.option(bcs.u64()),
});

const OptionalRangeStruct = bcs.option(RangeStruct);

const ResourceStruct = bcs.struct('Resource', {
  path: bcs.string(),
  headers: bcs.map(bcs.string(), bcs.string()),
  blob_id: bcs.u256(),
  blob_hash: bcs.u256(),
  range: OptionalRangeStruct,
});

const DynamicFieldStruct = bcs.struct('Field<ResourcePath, Resource>', {
  parentId: Address,
  name: ResourcePathStruct,
  value: ResourceStruct,
});

export const getUsedBlobIdsFromSite = async ({
  suiClient,
  siteObjectId,
}: {
  suiClient: SuiClient;
  siteObjectId: string;
}): Promise<string[]> => {
  const resourceIds = await getResourceObjects({
    suiClient,
    siteObjectId,
  });

  const resourceObjects = await getAllObjects(suiClient, {
    ids: resourceIds.map(obj => obj.objectId),
    include: { content: true },
  });

  const blobIdSet = new Set<string>();

  for (const obj of resourceObjects) {
    if (!obj.content) continue;
    const blobId = DynamicFieldStruct.parse(obj.content).value.blob_id;
    blobIdSet.add(blobId);
  }
  return Array.from(blobIdSet).map(blobId => blobIdFromInt(blobId));
};
