export const metadata = { title: "Outreach · Unlock" };

export default async function Unlock({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="unlock">
      <form method="post" action="/api/unlock">
        <div className="brand" style={{ padding: 0 }}>Outreach</div>
        <label htmlFor="code" className="meta">Enter the access code</label>
        <input id="code" name="code" type="password" autoComplete="current-password" required autoFocus />
        {error && <div className="banner error" role="alert" style={{ margin: 0 }}>That code is not right.</div>}
        <button className="btn primary" type="submit">Unlock</button>
      </form>
    </div>
  );
}
