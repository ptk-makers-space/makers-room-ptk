export async function register() {
  // Must be an `if` block (not an early return) so the edge build drops the import.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
