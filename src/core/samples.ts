// Built-in ORIGINAL template designs (read-only; using one creates a copy). Specs live in ./templates/<group>.ts.
import type { Design } from './types';
import { buildTemplate, type TemplateCategory, type TemplateSpec } from './templates/build';
import { CLASSIC } from './templates/classic';
import { ANIMALS } from './templates/animals';
import { FANTASY } from './templates/fantasy';
import { FOOD } from './templates/food';
import { WORLD } from './templates/world';

export { TEMPLATE_CATEGORIES, type TemplateCategory } from './templates/build';

const SPECS: TemplateSpec[] = [...CLASSIC, ...FANTASY, ...ANIMALS, ...FOOD, ...WORLD];

/** All built-in templates, fixed ids "tpl-<slug>". */
export const TEMPLATES: Design[] = SPECS.map(buildTemplate);

const CATEGORY_OF = new Map(SPECS.map((s) => [`tpl-${s.slug}`, s.category]));

/** Category of a built-in template (by design id). */
export function templateCategory(id: string): TemplateCategory | undefined {
  return CATEGORY_OF.get(id);
}
