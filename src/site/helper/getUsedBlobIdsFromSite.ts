import { bcs } from '@mysten/sui/bcs';
import { SuiClient } from '@mysten/sui/client';
import { fromBase64, fromHex, toHex } from '@mysten/sui/utils';

import { base64url } from '../../utils/base64url';
import { getAllObjects } from '../../utils/getAllObjects';

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
  Id: Address,
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
    options: { showType: true, showBcs: true },
  });

  const blobIdSet = new Set<string>();

  for (const obj of resourceObjects) {
    const bcsBytes = (obj.data as any)?.bcs?.bcsBytes;
    if (!bcsBytes) continue;
    const blobId = DynamicFieldStruct.parse(fromBase64(bcsBytes)).value.blob_id;
    blobIdSet.add(blobId);
  }
  return Array.from(blobIdSet).map(blobId => base64url.fromNumber(blobId));
};
