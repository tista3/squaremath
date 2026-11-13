// OWNER: shell agent. Pure helpers for the gallery's template filters (category + kind of maths), plus their
// per-session memory.
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '../../core/samples';
import type { Design, Op } from '../../core/types';

/** Kind of maths a puzzle uses: only + −, only × ÷, or both kinds. */
export type OpsLevel = 'addsub' | 'muldiv' | 'mixed';
export const OPS_LEVELS: readonly OpsLevel[] = ['addsub', 'muldiv', 'mixed'];

export type CategoryFilter = TemplateCategory | 'all';
export type OpsFilter = OpsLevel | 'all';
export interface TemplateFilter {
  category: CategoryFilter;
  ops: OpsFilter;
}
export const NO_FILTER: TemplateFilter = { category: 'all', ops: 'all' };

export function opsLevel(ops: readonly Op[]): OpsLevel {
  const addSub = ops.some((op) => op === 'add' || op === 'sub');
  const mulDiv = ops.some((op) => op === 'mul' || op === 'div');
  if (addSub && mulDiv) return 'mixed';
  return mulDiv ? 'muldiv' : 'addsub';
}

type CategoryOf = (id: string) => TemplateCategory | undefined;

export function matches(design: Design, filter: TemplateFilter, categoryOf: CategoryOf): boolean {
  if (filter.category !== 'all' && categoryOf(design.id) !== filter.category) return false;
  if (filter.ops !== 'all' && opsLevel(design.puzzle.ops) !== filter.ops) return false;
  return true;
}

export function filterTemplates(templates: readonly Design[], filter: TemplateFilter, categoryOf: CategoryOf): Design[] {
  return templates.filter((d) => matches(d, filter, categoryOf));
}

/**
 * Category chips in their canonical order, each with how many templates it holds under the current kind-of-maths
 * filter. Categories without any template at all are left out (a count of 0 only means "not with this maths").
 */
export function categoryCounts(
  templates: readonly Design[],
  ops: OpsFilter,
  categoryOf: CategoryOf,
): { category: CategoryFilter; count: number }[] {
  const total = new Map<TemplateCategory, number>();
  const shown = new Map<TemplateCategory, number>();
  let all = 0;
  for (const d of templates) {
    const c = categoryOf(d.id);
    if (c) total.set(c, (total.get(c) ?? 0) + 1);
    if (ops !== 'all' && opsLevel(d.puzzle.ops) !== ops) continue;
    all++;
    if (c) shown.set(c, (shown.get(c) ?? 0) + 1);
  }
  return [
    { category: 'all', count: all },
    ...TEMPLATE_CATEGORIES.filter((c) => total.has(c)).map((c) => ({ category: c, count: shown.get(c) ?? 0 })),
  ];
}

/** Kinds of maths present among the templates, in canonical order. */
export function opsLevelsPresent(templates: readonly Design[]): OpsLevel[] {
  const present = new Set(templates.map((d) => opsLevel(d.puzzle.ops)));
  return OPS_LEVELS.filter((l) => present.has(l));
}

// ---- Session memory ----

export const FILTER_STORAGE_KEY = 'squaremath.gallery.templateFilter';

function isCategory(v: unknown): v is CategoryFilter {
  return v === 'all' || (TEMPLATE_CATEGORIES as readonly unknown[]).includes(v);
}

function isOps(v: unknown): v is OpsFilter {
  return v === 'all' || (OPS_LEVELS as readonly unknown[]).includes(v);
}

/** Parses a stored filter; anything unknown (old/edited value) falls back to "all". */
export function parseFilter(raw: string | null): TemplateFilter {
  if (!raw) return NO_FILTER;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof TemplateFilter, unknown>> | null;
    return {
      category: isCategory(v?.category) ? v.category : 'all',
      ops: isOps(v?.ops) ? v.ops : 'all',
    };
  } catch {
    return NO_FILTER;
  }
}

export function loadFilter(): TemplateFilter {
  try {
    return parseFilter(sessionStorage.getItem(FILTER_STORAGE_KEY));
  } catch {
    return NO_FILTER; // storage blocked (privacy mode, sandboxed iframe)
  }
}

export function saveFilter(filter: TemplateFilter): void {
  try {
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Not remembering the filter is harmless.
  }
}
