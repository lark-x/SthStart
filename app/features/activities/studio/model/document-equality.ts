/** 与服务端 studioHash 一致：忽略键顺序与 undefined 字段，只比较内容本身。 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}

export function sameDocument(a: unknown, b: unknown) {
  return a !== undefined && a !== null && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
