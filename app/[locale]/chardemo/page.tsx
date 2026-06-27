"use client";

// TEMPORARY browser-verification page for the nuwa-distilled persona picker.
// Public (no auth). Loads the live /api/characters list when reachable, falls
// back to the static set otherwise. Delete this folder after verifying.

import { useEffect, useState } from "react";

interface CharacterOption { id: string; name: string; emoji: string; tagline: string }

const fallback: CharacterOption[] = [
  { id: "munger", name: "Charlie Munger", emoji: "🧠", tagline: "Multidisciplinary mental models, inversion, brutal clarity" },
  { id: "feynman", name: "Richard Feynman", emoji: "🔬", tagline: "First principles, explain it simply, intellectual honesty" },
  { id: "naval", name: "Naval Ravikant", emoji: "🚀", tagline: "Leverage, specific knowledge, wealth without luck" },
  { id: "paul-graham", name: "Paul Graham", emoji: "📝", tagline: "Make something people want, do things that don't scale" },
  { id: "steve-jobs", name: "Steve Jobs", emoji: "🍎", tagline: "Product taste, ruthless focus, story over spec" },
  { id: "zhang-yiming", name: "Zhang Yiming", emoji: "📈", tagline: "Global efficiency, data-driven growth, delayed gratification" },
  { id: "mrbeast", name: "MrBeast", emoji: "🎬", tagline: "Viral attention, retention obsession, reinvest everything" },
  { id: "taleb", name: "Nassim Taleb", emoji: "🦢", tagline: "Antifragility, tail risk, skin in the game" },
];

export default function CharDemoPage() {
  const [characters, setCharacters] = useState<CharacterOption[]>(fallback);
  const [source, setSource] = useState<"api" | "fallback">("fallback");
  const [selectedCharacter, setSelectedCharacter] = useState("munger");

  useEffect(() => {
    fetch("/api/characters")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (Array.isArray(data.characters) && data.characters.length) {
          setCharacters(data.characters);
          setSource("api");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-10">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold text-gray-800 flex items-center justify-between">
          <span>nuwa-distilled persona picker — verification ({characters.length})</span>
          <span className={`text-xs px-2 py-0.5 rounded ${source === "api" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
            {source === "api" ? "/api/characters (live)" : "fallback (login required for live)"}
          </span>
        </div>
        <div className="border-t border-gray-200 px-4 pt-2 pb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <select className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 bg-white cursor-pointer">
              <option>Auto (Best Available)</option>
            </select>
            <select
              value={selectedCharacter}
              onChange={(e) => setSelectedCharacter(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 bg-white cursor-pointer"
            >
              <option value="">No persona</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
              ))}
            </select>
            {selectedCharacter && (
              <span className="text-xs text-gray-400">{characters.find((c) => c.id === selectedCharacter)?.tagline}</span>
            )}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-100">
          <ul className="border border-gray-200 rounded-md divide-y text-sm">
            {characters.map((c) => (
              <li key={c.id} className="px-3 py-2 flex items-center gap-2">
                <span className="text-base">{c.emoji}</span>
                <span className="font-medium text-gray-800">{c.name}</span>
                <span className="text-gray-400 text-xs">— {c.tagline}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
