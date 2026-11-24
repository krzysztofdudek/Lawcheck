export interface Line {
  name: string;
  cents: number;
  quantity: number;
}

export interface Customer {
  id: string;
  orders: number;
}

export function lineTotal(line: Line): number {
  return line.cents * line.quantity;
}

export function orderTotal(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}
