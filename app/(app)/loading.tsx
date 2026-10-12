export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 40, width: "40%", marginBottom: 16 }} />
      <div className="skel" style={{ height: 16, width: "55%", marginBottom: 32 }} />
      <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 96 }} />)}</div>
    </div>
  );
}
