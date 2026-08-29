import { respread, splitEvenly, sumShares, validateSplit } from './split';

describe('splitEvenly', () => {
  it('splits without losing a cent', () => {
    // 10.00 three ways cannot divide evenly; the shares must still total 10.00.
    const shares = splitEvenly(10, [1, 2, 3]);
    expect(sumShares(shares)).toBeCloseTo(10, 10);
    expect(shares[1]).toBe(3.33);
    expect(shares[2]).toBe(3.33);
    expect(shares[3]).toBe(3.34);
  });

  it('puts the remainder on the last participant', () => {
    const shares = splitEvenly(1, [1, 2, 3]);
    expect(shares[1]).toBe(0.33);
    expect(shares[3]).toBe(0.34);
  });

  it('handles a single participant and an empty selection', () => {
    expect(splitEvenly(42.5, [7])).toEqual({ 7: 42.5 });
    expect(splitEvenly(10, [])).toEqual({});
  });
});

describe('validateSplit', () => {
  it('requires at least one participant', () => {
    expect(validateSplit('shares', {}, 10).valid).toBe(false);
  });

  it('accepts any positive share total in shares mode', () => {
    expect(validateSplit('shares', { 1: 1, 2: 3 }, 10).valid).toBe(true);
    expect(validateSplit('shares', { 1: 0, 2: 0 }, 10).valid).toBe(false);
  });

  it('requires percent to total 100 within a cent', () => {
    expect(validateSplit('percent', { 1: 50, 2: 50 }, 10).valid).toBe(true);
    expect(validateSplit('percent', { 1: 33.33, 2: 33.33, 3: 33.34 }, 10).valid).toBe(true);
    expect(validateSplit('percent', { 1: 50, 2: 40 }, 10).valid).toBe(false);
  });

  it('requires absolute shares to total the expense value', () => {
    expect(validateSplit('absolute', { 1: 6, 2: 4 }, 10).valid).toBe(true);
    expect(validateSplit('absolute', { 1: 6, 2: 3 }, 10).valid).toBe(false);
  });
});

describe('respread', () => {
  it('gives everyone one share in shares mode', () => {
    expect(respread('shares', [1, 2, 3], 10)).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it('produces percentages that total exactly 100', () => {
    // 100/3 is not representable in cents; the last row absorbs the difference.
    const shares = respread('percent', [1, 2, 3], 10);
    expect(sumShares(shares)).toBeCloseTo(100, 10);
    expect(validateSplit('percent', shares, 10).valid).toBe(true);
  });

  it('produces amounts that total exactly the value', () => {
    const shares = respread('absolute', [1, 2, 3], 10);
    expect(sumShares(shares)).toBeCloseTo(10, 10);
    expect(validateSplit('absolute', shares, 10).valid).toBe(true);
  });

  it('returns nothing for an empty selection', () => {
    expect(respread('absolute', [], 10)).toEqual({});
  });
});
