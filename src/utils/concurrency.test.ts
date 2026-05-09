import { mapWithConcurrencyLimit } from './concurrency';

describe('mapWithConcurrencyLimit', () => {
  it('preserves result order while capping concurrent work', async () => {
    let active = 0;
    let maxActive = 0;
    const values = [1, 2, 3, 4, 5];

    const results = await mapWithConcurrencyLimit(values, 2, async value => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('rejects invalid concurrency values', async () => {
    await expect(mapWithConcurrencyLimit([1], 0, async value => value)).rejects.toThrow(
      'concurrency must be a positive integer',
    );
  });
});
