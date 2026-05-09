import { bcs } from '@mysten/sui/bcs';

const InternalQuiltPatchId = bcs.struct('InternalQuiltPatchId', {
  version: bcs.u8(),
  startIndex: bcs.u16(),
  endIndex: bcs.u16(),
});

export const QUILT_PATCH_ID_INTERNAL_HEADER = 'x-wal-quilt-patch-internal-id';

// Walrus Sites stores only this 5-byte internal patch ID; the portal combines it with the quilt blob ID.
export function quiltPatchInternalId({
  startIndex,
  endIndex,
}: {
  startIndex: number;
  endIndex: number;
}): string {
  const bytes = InternalQuiltPatchId.serialize({
    version: 1,
    startIndex,
    endIndex,
  }).toBytes();

  return `0x${Buffer.from(bytes).toString('hex')}`;
}
