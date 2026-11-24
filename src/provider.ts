export type Resend = 'after-2s' | 'at-once' | false;

export type Asked = { answer: string } | { failure: string; resend: Resend; fix: string };

export interface Provider {
  // The exact keys this provider sends or hands on, which Lawcheck writes as [key] wherever a reply shows them.
  keys: string[];
  ready(): string | null;
  fix(): string;
  ask(prompt: string, seconds?: number): Promise<Asked>;
  probe?(): Promise<{ problem: string; fix: string } | { at: string }>;
}
