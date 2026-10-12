export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 44, width: "55%", marginBottom: 12 }} />
      <div className="skel" style={{ height: 18, width: "40%", marginBottom: 28 }} />
      <div className="funnel">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 120 }} />)}</div>
      <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 100 }} />)}</div>
    </div>
  );
}
