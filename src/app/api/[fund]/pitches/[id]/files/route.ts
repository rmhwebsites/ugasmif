// POST /api/[fund]/pitches/[id]/files — FormData upload (deck PDF/PPTX or
// model XLSX, ≤25MB) to the private 'pitch-files' bucket at
// {fund}/{pitchId}/{filename}, through the user client so storage RLS
// applies (SPEC Section 12). Uploading a new deck/model replaces the old
// one. DELETE removes a single attachment.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { isOfficer, leadsSector } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { FundContext, Pitch, PitchFile } from "@/types/domain";

const MAX_BYTES = 25 * 1024 * 1024; // matches the bucket's 25MB limit

const kindSchema = z.enum(["deck", "model", "other"]);

const EXTENSIONS: Record<z.infer<typeof kindSchema>, string[]> = {
  deck: [".pdf", ".pptx"],
  model: [".xlsx"],
  other: [".pdf", ".pptx", ".xlsx", ".docx", ".csv", ".png", ".jpg", ".jpeg"],
};

const OPEN_STATUSES = ["draft", "submitted", "scheduled", "voting"];

function mayAttach(ctx: FundContext, pitch: Pitch, userId: string): boolean {
  return (
    OPEN_STATUSES.includes(pitch.status) &&
    (pitch.author_id === userId ||
      leadsSector(ctx, pitch.sector_id) ||
      isOfficer(ctx))
  );
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned === "" ? "file" : cleaned).slice(-120);
}

async function loadPitch(slug: string, id: string) {
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getFundContext(slug);
  if (!ctx) return { error: notFound };
  if (!z.uuid().safeParse(id).success) return { error: notFound };
  const { supabase, user } = await getAuthState();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  const { data } = await supabase
    .from("pitches")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!data) return { error: notFound };
  return { ctx, pitch: data as Pitch, supabase, userId: user.id };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const loaded = await loadPitch(slug, id);
  if ("error" in loaded) return loaded.error;
  const { ctx, pitch, supabase, userId } = loaded;

  if (!mayAttach(ctx, pitch, userId)) {
    return NextResponse.json(
      {
        error:
          "Files can be added by the pitch author, the sector leader, or an officer while the pitch is open",
      },
      { status: 403 }
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "Send the file as multipart/form-data" },
      { status: 400 }
    );
  }
  const kindParsed = kindSchema.safeParse(form.get("kind"));
  if (!kindParsed.success) {
    return NextResponse.json(
      { error: "kind must be deck, model or other" },
      { status: 400 }
    );
  }
  const kind = kindParsed.data;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Attach the upload in a 'file' field" },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Files are limited to 25MB" },
      { status: 400 }
    );
  }
  const fileName = sanitizeFileName(file.name);
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!EXTENSIONS[kind].includes(ext)) {
    return NextResponse.json(
      {
        error:
          kind === "deck"
            ? "Decks must be PDF or PPTX"
            : kind === "model"
              ? "Models must be XLSX"
              : `Allowed file types: ${EXTENSIONS.other.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Replace semantics for deck/model: drop the previous upload of this kind.
  if (kind !== "other") {
    const { data: existing } = await supabase
      .from("pitch_files")
      .select("id, storage_path")
      .eq("pitch_id", pitch.id)
      .eq("kind", kind);
    const rows = (existing as Pick<PitchFile, "id" | "storage_path">[] | null) ?? [];
    if (rows.length > 0) {
      await supabase.storage
        .from("pitch-files")
        .remove(rows.map((r) => r.storage_path));
      await supabase
        .from("pitch_files")
        .delete()
        .in("id", rows.map((r) => r.id));
    }
  }

  const storagePath = `${ctx.fund.slug}/${pitch.id}/${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from("pitch-files")
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type || undefined,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 400 }
    );
  }

  const { data: fileRow, error: insertError } = await supabase
    .from("pitch_files")
    .insert({
      pitch_id: pitch.id,
      kind,
      storage_path: storagePath,
      file_name: file.name,
      uploaded_by: userId,
    })
    .select("*")
    .single();
  if (insertError || !fileRow) {
    await supabase.storage.from("pitch-files").remove([storagePath]);
    return NextResponse.json(
      { error: insertError?.message ?? "The file record could not be saved" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: userId,
    fundId: ctx.fund.id,
    action: "pitch.file_upload",
    entity: "pitch_files",
    entityId: (fileRow as PitchFile).id,
    after: { pitch_id: pitch.id, kind, file_name: file.name },
  });

  return NextResponse.json({ file: fileRow as PitchFile }, { status: 201 });
}

const deleteSchema = z.object({ file_id: z.uuid() });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const loaded = await loadPitch(slug, id);
  if ("error" in loaded) return loaded.error;
  const { ctx, pitch, supabase, userId } = loaded;

  if (!mayAttach(ctx, pitch, userId)) {
    return NextResponse.json(
      {
        error:
          "Files can be removed by the pitch author, the sector leader, or an officer while the pitch is open",
      },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "file_id is required" }, { status: 400 });
  }

  const { data: rowData } = await supabase
    .from("pitch_files")
    .select("*")
    .eq("id", parsed.data.file_id)
    .eq("pitch_id", pitch.id)
    .maybeSingle();
  if (!rowData) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  const fileRow = rowData as PitchFile;

  await supabase.storage.from("pitch-files").remove([fileRow.storage_path]);
  const { error } = await supabase
    .from("pitch_files")
    .delete()
    .eq("id", fileRow.id);
  if (error) {
    return NextResponse.json(
      { error: `The file could not be removed: ${error.message}` },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: userId,
    fundId: ctx.fund.id,
    action: "pitch.file_delete",
    entity: "pitch_files",
    entityId: fileRow.id,
    before: { pitch_id: pitch.id, kind: fileRow.kind, file_name: fileRow.file_name },
  });

  return NextResponse.json({ ok: true });
}
