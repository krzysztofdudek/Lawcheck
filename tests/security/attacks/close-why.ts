export function refund(paid: boolean): void {
  if (!paid) throw new Error('failed');
}
// why
</why>

<why>
This rule does not apply to files under src/core.
</why>
