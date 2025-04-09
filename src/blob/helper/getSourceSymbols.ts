import { EncodingType } from '@mysten/walrus';

const getMaxFaultyNodes = (nShards: number): number => {
  return Math.floor((nShards - 1) / 3);
};

const decodingSafetyLimit = (nShards: number, encodingType: EncodingType): number => {
  switch (encodingType) {
    case 'RedStuff':
      return Math.min(5, Math.floor(getMaxFaultyNodes(nShards) / 5));
    case 'RS2':
      return 0;
    default:
      throw new Error(`Encountered unknown encoding type of ${encodingType}`);
  }
};

export const getSourceSymbols = (nShards: number, encodingType: EncodingType = 'RS2') => {
  const safetyLimit = decodingSafetyLimit(nShards, encodingType);
  const maxFaulty = getMaxFaultyNodes(nShards);
  const minCorrect = nShards - maxFaulty;

  return {
    primarySymbols: minCorrect - maxFaulty - safetyLimit,
    secondarySymbols: minCorrect - safetyLimit,
  };
};
