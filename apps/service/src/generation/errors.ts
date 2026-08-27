export function generationError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function sanitizeErrorMessage(input: string): string {
  return input
    .replace(/(authorization|api[-_ ]?key|token|secret|password)(["'\s:=]+)([^\s,"'}]+)/gi, '$1$2[REDACTED]')
    .replace(/\b(?:sk|sth|Bearer)[-_][A-Za-z0-9._-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/([?&](?:key|token|secret|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\/\/[^:]+:[^@]+@/g, '//[REDACTED_AUTH]@')
    .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/g, '[USER_HOME]');
}
