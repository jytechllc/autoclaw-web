import en from "./en";
import zh from "./zh";
import zhTW from "./zh-TW";
import fr from "./fr";
import ko from "./ko";

export const locales = ["en", "zh", "zh-TW", "fr", "ko"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

const dictionaries = {
  en,
  zh,
  "zh-TW": zhTW,
  fr,
  ko,
};

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type Dictionary = DeepStringify<typeof en>;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] || dictionaries.en;
}
