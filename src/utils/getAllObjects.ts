import { SuiClient } from '@mysten/sui/client';
import type { MultiGetObjectsParams, SuiObjectResponse } from '@mysten/sui/client';

const chunkSize = 50;

export async function getAllObjects(
  client: SuiClient,
  { ids, ...rest }: MultiGetObjectsParams,
): Promise<SuiObjectResponse[]> {
  if (ids.length === 0) return [];

  const results: SuiObjectResponse[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const response = await client.multiGetObjects({
      ids: chunk,
      ...rest,
    });
    results.push(...response);
  }

  return results;
}
