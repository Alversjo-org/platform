/** Initials from the first two words of `name`, or the first letter of `email` if `name` is empty. */
export function avatarFallbackText(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  }
  return email.charAt(0).toUpperCase();
}
