import type { SuiClient, SuiClientTypes } from './suiClient';

const chunkSize = 50;

export async function getAllObjects<Include extends SuiClientTypes.ObjectInclude = {}>(
  client: SuiClient,
  {
    ids,
    include,
  }: {
    ids: string[];
    include?: Include & SuiClientTypes.ObjectInclude;
  },
): Promise<SuiClientTypes.Object<Include>[]> {
  if (ids.length === 0) return [];

  const results: SuiClientTypes.Object<Include>[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const response = await client.getObjects({
      objectIds: chunk,
      include,
    });

    for (const object of response.objects) {
      if (object instanceof Error) {
        throw object;
      }
      results.push(object);
    }
  }

  return results;
}
