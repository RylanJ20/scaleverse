// Character images are served as static assets from Vercel's CDN (public/),
// not Supabase Storage — keeps image traffic off the DB's egress quota.
// image_path is e.g. "characters/monkey-d-luffy.webp" → "/characters/monkey-d-luffy.webp".
export function characterImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return `/${imagePath}`;
}

// Base used by components that build `${IMAGE_BASE}/${form.image_path}`.
export const IMAGE_BASE = "";
