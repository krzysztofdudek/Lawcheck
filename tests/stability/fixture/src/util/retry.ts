export async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  // The bank's API drops the first request after an idle minute; one retry is enough.
  try {
    return await call();
  } catch {
    return await call();
  }
}
