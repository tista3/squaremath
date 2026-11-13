// Route map (HashRouter). Shared contract — do not change without updating App.tsx.
//
//   /                      Gallery: my designs + templates, create / import / export library
//   /d/:id/edit            Editor (draw the picture, palette, size)        — own designs
//   /d/:id/puzzle          Puzzle settings, sheet preview, print / PDF / PNG — own designs
//   /d/:id/solve           Interactive on-screen colouring by solving       — own designs
//   /s/:payload            Shared-link landing: preview, "save to my designs", solve, print
//   /s/:payload/puzzle     PuzzlePage read-only (settings changes stay local, not persisted)
//   /s/:payload/solve      SolvePage for a shared design
export type DesignSubPage = 'edit' | 'puzzle' | 'solve';

export const routes = {
  gallery: () => '/',
  design: (id: string, page: DesignSubPage) => `/d/${encodeURIComponent(id)}/${page}`,
  shared: (payload: string) => `/s/${payload}`,
  /** Sibling page relative to a page's basePath ("/d/<id>" or "/s/<payload>"). */
  sub: (basePath: string, page: DesignSubPage) => `${basePath}/${page}`,
};
