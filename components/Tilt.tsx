"use client";
import { useRef } from "react";

/** Small 3D tilt on hover (mouse only, off when the visitor prefers reduced motion). Children carry the visuals. */
export default function Tilt({ children, max = 4, className = "" }: { children: React.ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const set = (el: HTMLElement, rx: number, ry: number, gx: number, gy: number) => {
    el.style.setProperty("--rx", `${rx}deg`);
    el.style.setProperty("--ry", `${ry}deg`);
    el.style.setProperty("--gx", `${gx}%`);
    el.style.setProperty("--gy", `${gy}%`);
  };
  return (
    <div
      ref={ref}
      className={`tilt ${className}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== "mouse" || reduced()) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        set(el, -y * max * 2, x * max * 2, (x + 0.5) * 100, (y + 0.5) * 100);
      }}
      onPointerLeave={() => ref.current && set(ref.current, 0, 0, 50, 50)}
    >
      {children}
    </div>
  );
}
