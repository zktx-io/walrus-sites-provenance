import { bcs } from '@mysten/sui/bcs';

import { SuiClient, type SuiClientTypes } from '../../utils/suiClient';

const ResourcePathStruct = bcs.struct('ResourcePath', {
  path: bcs.string(),
});

export const getResourceObjects = async ({
  suiClient,
  siteObjectId,
}: {
  suiClient: SuiClient;
  siteObjectId: string;
}): Promise<{ objectId: string; path: string }[]> => {
  const resources: { objectId: string; path: string }[] = [];
  let cursor: string | undefined = undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const page: SuiClientTypes.ListDynamicFieldsResponse = await suiClient.listDynamicFields({
      parentId: siteObjectId,
      cursor,
      limit: 50,
    });

    resources.push(
      ...page.dynamicFields
        .filter(field => field.valueType.endsWith('::site::Resource'))
        .map(field => ({
          objectId: field.fieldId,
          path: ResourcePathStruct.parse(field.name.bcs).path,
        })),
    );

    hasNextPage = page.hasNextPage;
    cursor = page.cursor ?? undefined;
  }

  return resources;
};
