"use client";
import { useEffect } from "react";

/** Framer-style header: slides away when you scroll down, comes back when you scroll up, and gains a shadow once the page has moved. */
export default function ScrollHide() {
  useEffect(() => {
    const top = document.querySelector<HTMLElement>("header.top");
    if (!top) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      top.dataset.scrolled = y > 8 ? "true" : "false";
      top.dataset.hidden = y > last && y > 120 ? "true" : "false";
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return null;
}
