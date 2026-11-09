/** Keep resource filters, but never carry previous navigation envelopes back. */
export function withResourceReturn(href: string, resourceQuery: string): string {
  const source = new URLSearchParams(resourceQuery);
  source.delete('returnTo');
  source.delete('from');
  const query = source.toString();
  const separator = href.indexOf('?');
  const params = new URLSearchParams(separator >= 0 ? href.slice(separator + 1) : '');
  params.set('from', 'resources');
  params.set('returnTo', '/apps/resources' + (query ? '?' + query : ''));
  return (separator >= 0 ? href.slice(0, separator) : href) + '?' + params.toString();
}
