import { PageLoading } from "@/components/ui/PageLoading";

export default function NewPitchLoading() {
  return (
    <PageLoading
      title="New pitch"
      rows={5}
      back={{ label: "Pitches", path: "pitches" }}
    />
  );
}
