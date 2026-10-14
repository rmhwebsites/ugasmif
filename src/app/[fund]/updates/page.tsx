// /[fund]/updates — officer posts with unread highlighting (SPEC 11.2).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import {
  UpdatesList,
  type UpdateListItem,
} from "@/components/updates/UpdatesList";
import { EmptyState } from "@/components/ui/EmptyState";
import type { FundUpdate, Profile, UpdateRead } from "@/types/domain";
import { LinkButton, PageHeader } from "@/components/ui/PageHeader";
import { Plus } from "lucide-react";

export const metadata: Metadata = { title: "Updates" };

type UpdateRow = FundUpdate & {
  author?: Pick<Profile, "full_name"> | null;
};

export default async function UpdatesPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const [updatesRes, readsRes] = await Promise.all([
    supabase
      .from("fund_updates")
      .select("*, author:profiles!fund_updates_author_id_fkey(full_name)")
      .eq("fund_id", ctx.fund.id)
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false }),
    supabase
      .from("update_reads")
      .select("*")
      .eq("user_id", ctx.profile.id),
  ]);

  const updates = (updatesRes.data as UpdateRow[]) ?? [];
  const readIds = new Set(
    ((readsRes.data as UpdateRead[]) ?? []).map((r) => r.update_id)
  );
  const items: UpdateListItem[] = updates.map((u) => ({
    ...u,
    read: readIds.has(u.id),
  }));

  const canPost = can(ctx, "post_updates");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Updates"
        description="Announcements from the fund's officers."
        actions={
          canPost ? (
            <LinkButton href={`/${ctx.fund.slug}/admin/updates`}>
              <Plus className="h-4 w-4" /> Post an update
            </LinkButton>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="No updates yet"
          hint={
            canPost
              ? "Post the first one with the button above."
              : "Officers post announcements here — check back after the next class."
          }
        />
      ) : (
        <UpdatesList updates={items} fund={ctx.fund.slug} />
      )}
    </div>
  );
}
