/** Where the "Open" button points: the box's own hostname, entered through /__enter. */
export function boxOpenUrl(boxId: string): string {
  const domain = process.env.BOXES_DOMAIN ?? 'boxes.localhost';
  const scheme = domain.endsWith('.localhost') ? 'http' : 'https';
  const port = scheme === 'http' ? `:${process.env.PORT ?? 3000}` : '';
  return `${scheme}://${boxId}.${domain}${port}/__enter`;
}
