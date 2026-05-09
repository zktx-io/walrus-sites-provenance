export const hexToBase36 = (hex: string): string => {
  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }
  if (!hex) {
    throw new Error('hexToBase36: empty input');
  }
  const bigIntValue = BigInt('0x' + hex);
  return bigIntValue.toString(36);
};
