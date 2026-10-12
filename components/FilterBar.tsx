"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type Filter = { name: string; label: string; options: { value: string; label: string }[] };

/** Filters live in the URL, so a filtered view can be linked to and the server does the filtering. */
export default function FilterBar({ filters }: { filters: Filter[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <div className="filters">
      {filters.map((f) => (
        <label key={f.name}>
          {f.label}
          <select
            value={params.get(f.name) ?? ""}
            onChange={(e) => {
              const p = new URLSearchParams(params.toString());
              if (e.target.value) p.set(f.name, e.target.value);
              else p.delete(f.name);
              router.replace(p.size ? `${path}?${p}` : path, { scroll: false });
            }}
          >
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
