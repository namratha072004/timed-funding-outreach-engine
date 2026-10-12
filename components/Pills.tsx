export function EmailPill({ source, status }: { source: string; status?: string }) {
  if (status === "draft_failed") return <span className="pill none">Draft failed</span>;
  if (status === "sent") return <span className="pill sent">Sent</span>;
  if (status === "skipped") return <span className="pill skipped">Skipped</span>;
  if (source === "verified") return <span className="pill verified">Email verified</span>;
  if (source === "unverified") return <span className="pill check">Check the email first</span>;
  return <span className="pill none">No email found</span>;
}
