// Minimal i18n. UI text lives in per-namespace dictionaries (src/i18n/en/<ns>.ts), keys are "<ns>.<key>".
// Placeholders: "{name}". Plurals: when params.count is a number, "<key>_one" / "<key>_other" (any
// Intl.PluralRules category) is used if it exists, falling back to "<key>_other" and then "<key>". The UI is icon-first; text is for labels/tooltips. Colour NAMES are data
// (English by default, user-editable) and are never translated.
// To add a language: copy src/i18n/en to src/i18n/<lang>, add it to LANGS below.
import common from './en/common';
import gallery from './en/gallery';
import editor from './en/editor';
import puzzle from './en/puzzle';
import solve from './en/solve';
import shared from './en/shared';
import photo from './en/photo';
import symbols from './en/symbols';

type Dict = Record<string, string>;

function flatten(namespaces: Record<string, Dict>): Dict {
  const out: Dict = {};
  for (const [ns, dict] of Object.entries(namespaces)) {
    for (const [k, v] of Object.entries(dict)) out[`${ns}.${k}`] = v;
  }
  return out;
}

const LANGS: Record<string, Dict> = {
  en: flatten({ common, gallery, editor, puzzle, solve, shared, photo, symbols }),
};

let currentLang = 'en';
let current: Dict = LANGS.en;
let plurals = new Intl.PluralRules(currentLang);

export function setLanguage(lang: string): void {
  currentLang = lang in LANGS ? lang : 'en';
  current = LANGS[currentLang];
  plurals = new Intl.PluralRules(currentLang);
}

/** Picks the first browser language we have a dictionary for (e.g. "de-AT" -> "de"); call once before rendering. */
export function applyBrowserLanguage(): void {
  const wanted = navigator.languages?.length ? navigator.languages : [navigator.language];
  const lang = wanted.map((l) => l.toLowerCase().split('-')[0]).find((l) => l in LANGS) ?? 'en';
  setLanguage(lang);
  document.documentElement.lang = lang;
}

function lookup(key: string): string | undefined {
  return current[key] ?? LANGS.en[key];
}

/** The plural variant of `key` for `count` ("<key>_one", "<key>_other", ...), or `key` itself. */
function pluralKey(key: string, count: number): string {
  const variant = `${key}_${plurals.select(count)}`;
  if (lookup(variant) !== undefined) return variant;
  const other = `${key}_other`;
  return lookup(other) !== undefined ? other : key;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const count = params?.count;
  let s = lookup(typeof count === 'number' ? pluralKey(key, count) : key);
  if (s === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m));
  return s;
}

export function useT(): typeof t {
  return t;
}
