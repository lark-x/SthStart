export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function pollPlanning<T>({
  read,
  onValue,
  done,
  isMounted,
  attempts = 200,
  interval = 1500,
}: {
  read: () => Promise<T>;
  onValue: (value: T) => void;
  done: (value: T) => boolean;
  isMounted: () => boolean;
  attempts?: number;
  interval?: number;
}): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (!isMounted()) return value;
    onValue(value);
    if (done(value)) return value;
    await sleep(interval);
  }
  return null;
}
