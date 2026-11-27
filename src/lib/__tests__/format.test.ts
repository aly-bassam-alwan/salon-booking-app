import { formatDuration } from '../format';

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [30, '30 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [120, '2 h'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it('rejects negative or fractional values', () => {
    expect(() => formatDuration(-30)).toThrow(RangeError);
    expect(() => formatDuration(12.5)).toThrow(RangeError);
  });
});
