export interface Entry {
  account: string;
  amount: number;
}

export function post(ledger: Entry[], entry: Entry): Entry[] {
  ledger.push(entry);
  return ledger;
}
