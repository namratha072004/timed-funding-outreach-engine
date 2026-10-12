// A template remounts on every navigation, so each page fades up as it opens.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
