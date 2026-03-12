import { generateSlug } from './slug.util';

describe('generateSlug', () => {
  it('should generate a lowercase, hyphenated slug', async () => {
    expect(await generateSlug('Hello World')).toBe('hello-world');
  });

  it('should strip special characters', async () => {
    expect(await generateSlug('Nike Air Max 90 (2024)!')).toBe(
      'nike-air-max-90-2024',
    );
  });

  it('should return base slug when no uniqueness checker is provided', async () => {
    expect(await generateSlug('My Product')).toBe('my-product');
  });

  it('should return base slug when it is unique', async () => {
    const isUnique = jest.fn().mockResolvedValueOnce(false);
    const slug = await generateSlug('My Product', isUnique);
    expect(slug).toBe('my-product');
    expect(isUnique).toHaveBeenCalledWith('my-product');
  });

  it('should append -2 when base slug is taken', async () => {
    const isUnique = jest
      .fn()
      .mockResolvedValueOnce(true)   // 'my-product' is taken
      .mockResolvedValueOnce(false); // 'my-product-2' is free
    const slug = await generateSlug('My Product', isUnique);
    expect(slug).toBe('my-product-2');
  });

  it('should keep incrementing until a free slug is found', async () => {
    const isUnique = jest
      .fn()
      .mockResolvedValueOnce(true)   // taken
      .mockResolvedValueOnce(true)   // taken
      .mockResolvedValueOnce(false); // free
    const slug = await generateSlug('My Product', isUnique);
    expect(slug).toBe('my-product-3');
  });

  it('should handle strings that produce the same base slug', async () => {
    expect(await generateSlug('  Trim Me  ')).toBe('trim-me');
  });
});
