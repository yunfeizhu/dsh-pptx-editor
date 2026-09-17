/** Namespace native recovery snapshots by conversation, source occurrence and input bytes. */
export async function recoveryKey(
  sessionId: string,
  source: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const digest = async (data: Uint8Array) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', data.slice().buffer),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  const identity = JSON.stringify([
    'dsh-pptx-recovery-v1',
    sessionId,
    source,
    name,
    await digest(bytes),
  ]);
  return `dsh-pptx/${await digest(new TextEncoder().encode(identity))}/${name}`;
}
