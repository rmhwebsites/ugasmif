// Audit logging via the security-definer RPC log_audit (migration 0001).
// The RPC records auth.uid() as actor_id server-side — a user-scoped client
// logs as the signed-in user, the service client (cron) logs actor_id = null.
// Audit must never break the main write: every failure path is swallowed and
// reported with console.error.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  /**
   * Accepted for call-site symmetry, but the actor is derived server-side
   * from auth.uid() inside the security-definer RPC — this field is not
   * transmitted (a caller cannot spoof another actor).
   */
  actorId: string | null;
  fundId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Insert an audit_log row through supabase.rpc("log_audit", ...).
 * Never throws; RPC errors are logged and swallowed so the write that is
 * being audited always wins.
 */
export async function logAudit(
  supabase: SupabaseClient,
  entry: AuditEntry
): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_audit", {
      p_fund_id: entry.fundId,
      p_action: entry.action,
      p_entity: entry.entity,
      p_entity_id: entry.entityId ?? null,
      p_before: entry.before ?? null,
      p_after: entry.after ?? null,
      p_ip: entry.ip ?? null,
    });
    if (error) {
      console.error(
        `logAudit failed (${entry.action} ${entry.entity}):`,
        error.message
      );
    }
  } catch (err) {
    console.error(`logAudit failed (${entry.action} ${entry.entity}):`, err);
  }
}
