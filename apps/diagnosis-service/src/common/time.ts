export function hhmmss(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export function hhmmUtc(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}

export function minutesBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60_000);
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
