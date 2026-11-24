import type { IncomingMessage, ServerResponse } from "node:http";
import { lineTotal, orderTotal, type Line } from "../core/price.ts";
import { formatMoney } from "./format.ts";

export function receipt(lines: Line[]): string[] {
  const rows = lines.map((line) => `${line.quantity} x ${line.name}  ${formatMoney(lineTotal(line))}`);
  return [...rows, `Total  ${formatMoney(orderTotal(lines))}`];
}

export async function postOrder(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  let lines: Line[];
  try {
    lines = JSON.parse(Buffer.concat(chunks).toString("utf8")).lines;
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "the body is not JSON" }));
    return;
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    response.writeHead(422, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "an order needs at least one line" }));
    return;
  }
  response.writeHead(201, { "content-type": "application/json" });
  response.end(JSON.stringify({ total: orderTotal(lines), receipt: receipt(lines) }));
}
