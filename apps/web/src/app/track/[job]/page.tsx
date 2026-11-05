import { TrackView } from "@/components/track-view";

export const metadata = { title: "Your technician: live arrival", robots: { index: false } };

export default async function TrackPage({ params, searchParams }: { params: Promise<{ job: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { job } = await params;
  const query = await searchParams;
  return <TrackView jobId={job} t={Number(query.t) || undefined} tech={query.tech} slot={Number(query.slot)} at={Number(query.at)} />;
}
