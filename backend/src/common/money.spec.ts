import { BadRequestException } from '@nestjs/common';
import { rupeesToPaise, optionalRupeesToPaise } from './money';

describe('money — rupeesToPaise (rupee→paise boundary conversion)', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise(100)).toBe(10000);
    expect(rupeesToPaise(1)).toBe(100);
  });

  it('converts two-decimal rupees exactly', () => {
    expect(rupeesToPaise(99.99)).toBe(9999);
    expect(rupeesToPaise(0.01)).toBe(1);
    expect(rupeesToPaise(1234.56)).toBe(123456);
  });

  it('accepts zero', () => {
    expect(rupeesToPaise(0)).toBe(0);
  });

  it('rejects sub-paise / fractional-paise inputs (float-trap 99.005)', () => {
    expect(() => rupeesToPaise(99.005)).toThrow(BadRequestException);
    expect(() => rupeesToPaise(0.001)).toThrow(BadRequestException);
  });

  it('rejects negative amounts', () => {
    expect(() => rupeesToPaise(-1)).toThrow(BadRequestException);
  });

  it('rejects non-finite / non-number inputs', () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(BadRequestException);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(BadRequestException);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => rupeesToPaise('50' as any)).toThrow(BadRequestException);
  });

  it('rejects amounts too large to be a safe integer of paise', () => {
    expect(() => rupeesToPaise(1e15)).toThrow(BadRequestException);
  });

  it('uses the field name in the error message', () => {
    expect(() => rupeesToPaise(-1, 'salePrice')).toThrow(/salePrice/);
  });
});

describe('money — optionalRupeesToPaise', () => {
  it('passes through null/undefined as undefined', () => {
    expect(optionalRupeesToPaise(null)).toBeUndefined();
    expect(optionalRupeesToPaise(undefined)).toBeUndefined();
  });

  it('converts a present value', () => {
    expect(optionalRupeesToPaise(50)).toBe(5000);
  });

  it('still rejects an invalid present value', () => {
    expect(() => optionalRupeesToPaise(1.999)).toThrow(BadRequestException);
  });
});
