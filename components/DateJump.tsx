"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  min: string; // YYYY-MM-DD
  max: string; // YYYY-MM-DD
  className?: string;
};

function isoToRoute(iso: string) {
  const [y, m, d] = iso.split("-");
  return `/${y}/${m}/${d}`;
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default function DateJump({ min, max, className }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const placeholder = useMemo(() => `${min} … ${max}`, [min, max]);

  function go() {
    const v = value.trim();
    if (!isIsoDate(v)) {
      setErr("Use YYYY-MM-DD.");
      return;
    }
    if (v < min || v > max) {
      setErr(`Out of range. Use ${min} to ${max}.`);
      return;
    }
    setErr(null);
    router.push(isoToRoute(v));
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          placeholder={placeholder}
          className="border rounded-xl px-3 py-2 w-48"
          inputMode="numeric"
          aria-label="Jump to date"
        />
        <button
          onClick={go}
          className="border rounded-xl px-4 py-2"
          type="button"
        >
          Jump
        </button>
      </div>
      {err ? <p className="mt-2 text-sm opacity-80">{err}</p> : null}
    </div>
  );
}
