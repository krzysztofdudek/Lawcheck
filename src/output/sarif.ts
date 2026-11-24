export interface SarifFinding {
  code: string;
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
  why: string;
}

export interface SarifTool {
  version: string;
  pathBytes: (file: string) => Uint8Array;
}

export const SARIF_SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

const UNRESERVED = /^[A-Za-z0-9\-._~/]$/;

// RFC 3986 lets a URI hold only these characters raw; every other byte of the path, a byte outside valid UTF-8 included, is written as %XX.
export function uriOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && UNRESERVED.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function helpOf(finding: SarifFinding, codes: ReadonlySet<string>): string {
  return codes.has(finding.code) ? `${finding.why}\n\nlawcheck docs codes` : `${finding.why}\n\nlawcheck explain --rule ${finding.code}`;
}

export function sarifLog(findings: readonly SarifFinding[], codes: ReadonlySet<string>, tool: SarifTool): string {
  const first = new Map<string, SarifFinding>();
  for (const finding of findings) if (!first.has(finding.code)) first.set(finding.code, finding);
  const ids = [...first.keys()].sort();
  const index = new Map(ids.map((id, at) => [id, at]));
  const rules = ids.map((id) => {
    const finding = first.get(id)!;
    return {
      id,
      shortDescription: { text: finding.why },
      fullDescription: { text: finding.why },
      help: { text: helpOf(finding, codes) },
    };
  });
  const results = findings.map((finding) => ({
    ruleId: finding.code,
    ruleIndex: index.get(finding.code)!,
    level: finding.severity,
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: uriOf(tool.pathBytes(finding.file)), uriBaseId: '%SRCROOT%' },
          region: { startLine: finding.line ?? 1 },
        },
      },
    ],
  }));
  const log = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'Lawcheck', semanticVersion: tool.version, informationUri: 'https://lawcheck.dev', rules } },
        results,
      },
    ],
  };
  return JSON.stringify(log, null, 2) + '\n';
}
