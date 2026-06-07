// Stub — Task 7R fills this with the full notify-only handler implementation.
export async function handle(): Promise<void> {
  // Consume stdin, do nothing; never throw (hook invariant).
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
}
