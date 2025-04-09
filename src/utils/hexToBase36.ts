export const hexToBase36 = (hex: string): string => {
  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }
  const bigIntValue = BigInt('0x' + hex);
  return bigIntValue.toString(36);
};
