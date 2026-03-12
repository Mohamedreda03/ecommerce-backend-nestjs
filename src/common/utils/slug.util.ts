import slugify from 'slugify';

/**
 * Generates a URL-safe slug from a string.
 * If a uniqueness checker is provided and the base slug already exists,
 * appends -2, -3, … until a unique slug is found.
 *
 * @param text  The source string (e.g. product name, category title)
 * @param isUnique  Optional async callback — return true if the candidate slug is
 *                  already taken, false if it is free.
 */
export async function generateSlug(
  text: string,
  isUnique?: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(text, { lower: true, strict: true, trim: true });

  if (!isUnique) return base;

  let candidate = base;
  let counter = 2;

  while (await isUnique(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }

  return candidate;
}
