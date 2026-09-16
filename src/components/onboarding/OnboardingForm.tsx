"use client";

// First-run onboarding form. The photo goes straight to Supabase Storage from
// the browser (RLS lets a member write only their own {user_id}/ folder), then
// the resulting URL is saved with the rest of the details in one request.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { SmifSpinner } from "@/components/ui/SmifSpinner";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export interface SectorPicker {
  membershipId: string;
  fundId: string;
  fundName: string;
  currentSectorId: string | null;
  sectors: { id: string; name: string }[];
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

function initials(first: string, last: string): string {
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "?";
}

export function OnboardingForm({
  email,
  initialFirstName,
  initialLastName,
  initialPhone,
  initialAvatarUrl,
  userId,
  pickers,
}: {
  email: string;
  initialFirstName: string;
  initialLastName: string;
  initialPhone: string;
  initialAvatarUrl: string | null;
  userId: string;
  pickers: SectorPicker[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [phone, setPhone] = useState(initialPhone);
  const [sectorIds, setSectorIds] = useState<Record<string, string>>(
    Object.fromEntries(pickers.map((p) => [p.membershipId, p.currentSectorId ?? ""]))
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [preview, setPreview] = useState<string | null>(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB. Keep it under 2MB.`
      );
      return;
    }

    setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    setUploading(false);

    if (uploadError) {
      setError(`Photo upload failed: ${uploadError.message}`);
      setPreview(avatarUrl);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are both required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
        avatar_url: avatarUrl,
        sectors: pickers
          .map((p) => ({
            membership_id: p.membershipId,
            sector_id: sectorIds[p.membershipId] || null,
          }))
          .filter((s) => s.sector_id !== null),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save your details.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Photo */}
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-highlight">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xl font-semibold text-muted">
              {initials(firstName, lastName)}
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

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <label className={labelClass} htmlFor="first_name">
            First name
          </label>
          <input
            id="first_name"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="last_name">
            Last name
          </label>
          <input
            id="last_name"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          readOnly
          className={`${inputClass} cursor-not-allowed opacity-70`}
        />
        <p className="mt-1 text-xs text-muted">
          This is the address you sign in with. An officer can change it.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="phone">
          Phone
        </label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          placeholder="706-555-0100"
        />
      </div>

      {pickers.map((p) => (
        <div key={p.membershipId}>
          <label className={labelClass} htmlFor={`sector-${p.membershipId}`}>
            {pickers.length > 1 ? `${p.fundName} sector` : "Your sector"}
          </label>
          <select
            id={`sector-${p.membershipId}`}
            value={sectorIds[p.membershipId] ?? ""}
            onChange={(e) =>
              setSectorIds({ ...sectorIds, [p.membershipId]: e.target.value })
            }
            className={inputClass}
          >
            <option value="">Not sure yet</option>
            {p.sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ))}

      {pickers.length === 0 && (
        <p className="rounded-lg bg-highlight px-3 py-2 text-sm text-muted">
          You&apos;re not on a fund roster yet, so there&apos;s no sector to
          pick. An officer can add you.
        </p>
      )}

      {error && <p className="text-sm text-loss">{error}</p>}

      <Button type="submit" disabled={saving || uploading} className="w-full">
        {saving ? <SmifSpinner size="sm" label={null} /> : null}
        {saving ? "Saving…" : "Finish setup"}
      </Button>
    </form>
  );
}
