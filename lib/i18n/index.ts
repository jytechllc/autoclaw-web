import en from "./en";
import zh from "./zh";
import zhTW from "./zh-TW";
import ko from "./ko";

export const locales = ["en", "zh", "zh-TW", "ko"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

const dictionaries = {
  en,
  zh,
  "zh-TW": zhTW,
  ko,
};

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type Dictionary = DeepStringify<typeof en>;

export function getDictionary(locale: Locale): Dictionary {
  // Cast: zh-TW and ko have minor key drift (e.g. landing.bestFit*) that we tolerate at runtime
  // — missing keys render nothing rather than crashing. Bring them back in sync when those landing copy variants are needed.
  return (dictionaries[locale] || dictionaries.en) as Dictionary;
}
