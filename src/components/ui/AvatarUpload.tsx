"use client";

// Photo picker shared by onboarding and the profile page. The file goes
// straight from the browser to Supabase Storage — RLS lets a member write
// only their own {user_id}/ folder — and the caller saves the resulting
// public URL with the rest of its form.
//
// The 2MB cap is checked here and again by the bucket, so a hand-crafted
// request cannot get past it.

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { SmifSpinner } from "@/components/ui/SmifSpinner";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export function AvatarUpload({
  userId,
  value,
  initials,
  onChange,
  onError,
  onUploadingChange,
  size = "lg",
}: {
  userId: string;
  /** Current avatar URL, or null. */
  value: string | null;
  /** Fallback shown when there is no photo. */
  initials: string;
  onChange: (url: string) => void;
  onError: (message: string | null) => void;
  /** So the caller can disable its submit button mid-upload. */
  onUploadingChange?: (uploading: boolean) => void;
  size?: "md" | "lg";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value);
  const [uploading, setUploading] = useState(false);

  function setBusy(next: boolean) {
    setUploading(next);
    onUploadingChange?.(next);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onError(null);

    if (!ACCEPTED.includes(file.type)) {
      onError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      onError(
        `That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB. Keep it under 2MB.`
      );
      return;
    }

    setBusy(true);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    setBusy(false);

    if (uploadError) {
      onError(`Photo upload failed: ${uploadError.message}`);
      setPreview(value);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    onChange(data.publicUrl);
  }

  const box = size === "lg" ? "h-20 w-20" : "h-14 w-14";
  const text = size === "lg" ? "text-xl" : "text-base";

  return (
    <div className="flex items-center gap-4">
      <div
        className={`relative ${box} shrink-0 overflow-hidden rounded-full bg-highlight`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            className={`flex h-full w-full items-center justify-center ${text} font-semibold text-muted`}
          >
            {initials}
          </span>
        )}
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50">
            <SmifSpinner size="sm" label="Uploading photo" />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <Button
          type="button"
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Camera className="h-4 w-4" />
          {preview ? "Change photo" : "Add a photo"}
        </Button>
        <p className="mt-1 text-xs text-muted">JPEG, PNG or WebP, under 2MB.</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED.join(",")}
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}
