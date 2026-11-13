import { storage } from '../storage';

export async function exportReport(id: string, bytes: Uint8Array) {
  if (bytes.length > 10_000_000) throw new Error('The export failed: the report is larger than 10 MB.');
  return storage.put(`reports/${id}`, bytes);
}
