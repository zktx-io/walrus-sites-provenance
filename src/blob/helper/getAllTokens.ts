import { SuiClient } from '@mysten/sui/client';

export const getAllTokens = async ({
  suiClient,
  owner,
  coinType,
}: {
  suiClient: SuiClient;
  owner: string;
  coinType: string;
}): Promise<string[]> => {
  let hasNextPage = true;
  let cursor: string | undefined = undefined;

  const objectIds: string[] = [];
  while (hasNextPage) {
    const page = await suiClient.getOwnedObjects({
      owner,
      filter: {
        StructType: `0x2::coin::Coin<${coinType}>`,
      },
      options: { showType: true, showBcs: true, showContent: true },
      cursor,
      limit: 50,
    });
    objectIds.push(...page.data.map(item => (item.data as any).objectId as string));
    hasNextPage = page.hasNextPage;
    cursor = page.nextCursor ?? undefined;
  }

  return objectIds;
};
