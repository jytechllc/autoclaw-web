"use client";

import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { type Locale } from "@/lib/i18n";

const LANGUAGES: { code: Locale; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "EN" },
  { code: "zh", label: "简体中文", flag: "中" },
  { code: "zh-TW", label: "繁體中文", flag: "繁" },
  { code: "fr", label: "Français", flag: "FR" },
  { code: "ko", label: "한국어", flag: "KO" },
];

export default function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === locale) || LANGUAGES[0];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function switchTo(code: Locale) {
    if (code === locale) { setOpen(false); return; }
    const newPath = pathname.replace(`/${locale}`, `/${code}`) || `/${code}`;
    document.cookie = `locale=${code};path=/;max-age=31536000`;
    window.location.href = newPath;
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer px-2 py-1 rounded border border-gray-200 hover:border-gray-300"
      >
        <span className="font-medium">{current.flag}</span>
        <span className="hidden sm:inline">{current.label}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => switchTo(lang.code)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors cursor-pointer ${
                lang.code === locale
                  ? "bg-red-50 text-red-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="w-6 text-center font-medium text-xs">{lang.flag}</span>
              <span>{lang.label}</span>
              {lang.code === locale && (
                <svg className="w-4 h-4 ml-auto text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
