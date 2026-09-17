import { randomUUID } from 'node:crypto';
import {
  replySchema,
  EDITOR_LEASE_MS,
  type EditorCommand,
  type EditorReply,
  type EditorRequest,
} from '../protocol.js';

interface Pending {
  request: EditorRequest;
  delivered: boolean;
  settle(reply: EditorReply): void;
}
interface Lease {
  clientId: string;
  touched: number;
  pending: Map<string, Pending>;
}

/** Routes ephemeral commands to one browser owner per DSH session. No document mirror. */
export class EditorBroker {
  private readonly leases = new Map<string, Lease>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly leaseMs = EDITOR_LEASE_MS,
    private readonly timeoutMs = 30_000,
  ) {}

  claim(sessionId: string, clientId: string): void {
    this.expire();
    const lease = this.leases.get(sessionId);
    if (lease && lease.clientId !== clientId)
      throw new Error('This session already has an editor open');
    if (!lease && this.leases.size >= 64)
      throw new Error('Too many open editors');
    this.leases.set(
      sessionId,
      lease ?? { clientId, touched: this.now(), pending: new Map() },
    );
  }

  exchange(
    sessionId: string,
    clientId: string,
    reply?: { id: string; result: EditorReply },
  ): EditorRequest[] {
    this.expire();
    const lease = this.leases.get(sessionId);
    if (lease?.clientId !== clientId)
      throw new Error('Editor disconnected; reopen the PPTX tab');
    lease.touched = this.now();
    if (reply)
      lease.pending.get(reply.id)?.settle(replySchema.parse(reply.result));
    const requests: EditorRequest[] = [];
    for (const entry of lease.pending.values()) {
      if (entry.delivered) continue;
      entry.delivered = true;
      requests.push(entry.request);
    }
    return requests;
  }

  async request(
    sessionId: string,
    command: EditorCommand,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    this.expire();
    const lease = this.leases.get(sessionId);
    if (!lease)
      throw new Error('Open the PPTX editor tab in this DSH session first');
    if (lease.pending.size)
      throw new Error('An editor request is already in progress');
    const id = randomUUID();
    const reply = await new Promise<EditorReply>((resolve) => {
      const settle = (value: EditorReply) => {
        lease.pending.delete(id);
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = () => {
        settle({ ok: false, error: 'Editor request cancelled' });
      };
      const timer = setTimeout(() => {
        settle({ ok: false, error: 'Editor did not respond in time' });
      }, this.timeoutMs);
      lease.pending.set(id, {
        request: { id, command },
        delivered: false,
        settle,
      });
      signal.addEventListener('abort', abort, { once: true });
    });
    signal.throwIfAborted();
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  }

  release(sessionId: string, clientId: string): void {
    const lease = this.leases.get(sessionId);
    if (lease?.clientId !== clientId) return;
    this.leases.delete(sessionId);
    for (const entry of lease.pending.values())
      entry.settle({ ok: false, error: 'Editor disconnected' });
  }

  expire(): void {
    for (const [sessionId, lease] of this.leases) {
      if (this.now() - lease.touched > this.leaseMs)
        this.release(sessionId, lease.clientId);
    }
  }

  dispose(): void {
    for (const [sessionId, lease] of this.leases)
      this.release(sessionId, lease.clientId);
  }
}
