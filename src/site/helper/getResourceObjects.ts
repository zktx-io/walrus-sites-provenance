import { SuiClient } from '@mysten/sui/client';

export const getResourceObjects = async ({
  suiClient,
  siteObjectId,
}: {
  suiClient: SuiClient;
  siteObjectId: string;
}): Promise<{ objectId: string; path: string }[]> => {
  const dynamicFields = await suiClient.getDynamicFields({
    parentId: siteObjectId,
  });

  return dynamicFields.data
    .filter(field => field.objectType.endsWith('::site::Resource'))
    .map(field => {
      return {
        objectId: field.objectId,
        path: (field.name.value as any).path,
      };
    });
};
