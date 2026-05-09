import { normalizeSuiAddress } from '@mysten/sui/utils';

const SUI_HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

export const normalizeConfiguredSuiAddress = (address: string, label = 'Sui address'): string => {
  const trimmed = address.trim();
  if (!SUI_HEX_ADDRESS_RE.test(trimmed)) {
    throw new Error(`${label} must be a 0x-prefixed hex Sui address with at most 64 hex digits.`);
  }
  return normalizeSuiAddress(trimmed);
};
