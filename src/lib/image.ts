export function characterImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/character-images/${imagePath}`;
}
