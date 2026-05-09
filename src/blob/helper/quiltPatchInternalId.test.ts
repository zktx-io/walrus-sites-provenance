import { quiltPatchInternalId } from './quiltPatchInternalId';

describe('quiltPatchInternalId', () => {
  it('serializes version and patch indexes as the Walrus Sites internal header bytes', () => {
    expect(quiltPatchInternalId({ startIndex: 1, endIndex: 2 })).toBe('0x0101000200');
  });
});
