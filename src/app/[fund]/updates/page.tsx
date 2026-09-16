// /[fund]/updates — officer posts with unread highlighting (SPEC 11.2).

import type { Metadata } from "next";
import Link from "next/link";
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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Updates</h1>
        {canPost && (
          <Link
            href={`/${ctx.fund.slug}/admin/updates`}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Post an update
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No updates yet"
          hint={
            canPost
              ? "Post the first update from the admin page."
              : "Officers post announcements here — check back after the next class."
          }
        />
      ) : (
        <UpdatesList updates={items} fund={ctx.fund.slug} />
      )}
    </div>
  );
}
