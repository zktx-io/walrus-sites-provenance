import { EncodingType } from '@mysten/walrus';

import { getSourceSymbols } from './getSourceSymbols';

const DIGEST_LEN = 32;
const BLOB_ID_LEN = 32;

export const encodedBlobLength = (
  unencodedLength: number,
  nShards: number,
  encodingType: EncodingType = 'RS2',
): number => {
  const { primarySymbols, secondarySymbols } = getSourceSymbols(nShards, encodingType);

  let size =
    Math.floor((Math.max(unencodedLength, 1) - 1) / (primarySymbols * secondarySymbols)) + 1;

  if (encodingType === 'RS2' && size % 2 === 1) {
    size = size + 1;
  }

  const sliversSize = (primarySymbols + secondarySymbols) * size * nShards;
  const metadata = nShards * DIGEST_LEN * 2 + BLOB_ID_LEN;
  return nShards * metadata + sliversSize;
};
