"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="banner error" role="alert">
      <b>Something went wrong.</b> {error.message?.replace(/(key|token|secret)\S*/gi, "***").slice(0, 200)}{" "}
      <button className="btn sm" onClick={reset}>Try again</button>
    </div>
  );
}
