import { hexToBase36 } from './hexToBase36';

describe('hexToBase36', () => {
  it('converts hex object IDs to base36', () => {
    expect(hexToBase36('0x1')).toBe('1');
    expect(hexToBase36('ff')).toBe('73');
  });

  it('rejects empty input with a clear error', () => {
    expect(() => hexToBase36('')).toThrow('hexToBase36: empty input');
    expect(() => hexToBase36('0x')).toThrow('hexToBase36: empty input');
  });
});
