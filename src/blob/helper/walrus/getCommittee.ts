import { BcsType, fromBase64, InferBcsType } from '@mysten/bcs';
import { SuiClient } from '@mysten/sui/client';
import { CommitteeInfo, StorageNode } from '@mysten/walrus';
import { Committee, StakingPool } from './contracts';
import { getAllObjects } from '../../../utils/getAllObjects';

const getShardIndicesByNodeId = (committee: InferBcsType<ReturnType<typeof Committee>>) => {
  const shardIndicesByNodeId = new Map<string, number[]>();

  for (const node of committee.pos0.contents) {
    if (!shardIndicesByNodeId.has(node.key)) {
      shardIndicesByNodeId.set(node.key, []);
    }
    shardIndicesByNodeId.get(node.key)!.push(...node.value);
  }

  return shardIndicesByNodeId;
};

const loadManyOrThrow = async <T>(
  suiClient: SuiClient,
  ids: string[],
  schema: BcsType<T, any>,
): Promise<T[]> => {
  const response = await getAllObjects(suiClient, {
    ids,
    options: { showBcs: true, showOwner: true },
  });

  const objects: {
    id: string;
    version: string;
    digest: string;
    type: string;
    content: Uint8Array;
    owner: {
      $kind: 'ObjectOwner';
      ObjectOwner: string;
    };
  }[] = response.map(obj => {
    return {
      id: obj.data?.objectId!,
      version: obj.data?.version!,
      digest: obj.data?.digest!,
      type: (obj.data?.bcs as any).type,
      content: fromBase64((obj.data?.bcs as any).bcsBytes),
      owner: {
        $kind: 'ObjectOwner',
        ObjectOwner: (obj.data?.owner as any).ObjectOwner,
      },
    };
  });

  const parsed = objects.map(obj => {
    if (obj instanceof Error) throw obj;
    return schema.parse(obj.content);
  });

  return parsed;
};

const getStakingPool = async (
  SuiClient: SuiClient,
  committee: InferBcsType<ReturnType<typeof Committee>>,
): Promise<InferBcsType<ReturnType<typeof StakingPool>>[]> => {
  const nodeIds = committee.pos0.contents.map((node: { key: string; value: number[] }) => node.key);
  return await loadManyOrThrow(SuiClient, nodeIds, StakingPool() as any);
};

export const getCommittee = async (
  SuiClient: SuiClient,
  committee: InferBcsType<ReturnType<typeof Committee>>,
): Promise<CommitteeInfo> => {
  const stakingPool = await getStakingPool(SuiClient, committee);
  const shardIndicesByNodeId = getShardIndicesByNodeId(committee);

  const byShardIndex = new Map<number, StorageNode>();
  const nodes = stakingPool.map(({ node_info }, nodeIndex) => {
    const shardIndices = shardIndicesByNodeId.get(node_info.node_id) ?? [];
    const node: StorageNode = {
      id: node_info.node_id,
      info: node_info,
      networkUrl: `https://${node_info.network_address}`,
      shardIndices,
      nodeIndex,
    };

    for (const shardIndex of shardIndices) {
      byShardIndex.set(shardIndex, node);
    }

    return node;
  });

  return {
    byShardIndex,
    nodes,
  };
};
