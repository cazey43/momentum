/**
 * Pure slug helpers, kept free of any Node built-in so both the server
 * (paths/validation) and the client (live preview) can import them.
 */

/**
 * Normalizes a name into a safe skill slug: lowercase, spaces/underscores →
 * hyphens, drop anything else, collapse and trim hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** A slug is valid iff slugify is idempotent on it and it is a sane length. */
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 64 && slugify(slug) === slug
}
