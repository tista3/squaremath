// OWNER: shell agent. Flat keys, English UI strings for namespace "common" (used as t("common.<key>")).
// Only strings that are really shared live here; page-specific wording belongs in the page's namespace.
const dict: Record<string, string> = {
  // Generic actions (available to every page)
  ok: 'OK',
  cancel: 'Cancel',
  close: 'Close',
  dismiss: 'Dismiss',
  share: 'Share',
  operations: 'Operations',
  home: 'Home',
  loading: 'Loading…',
  /** The one wording for saving a shared design / template into the library (puzzle, solve, shared pages). */
  saveToMyDesigns: 'Save to my designs',
  /** Short variant of saveToMyDesigns for tight toolbars (use saveToMyDesigns as its tooltip). */
  saveToMyDesignsShort: 'Save',
  /** Shown instead of saveToMyDesigns when an unchanged copy is already in the library. */
  openMyCopy: 'Open my copy',

  // Share dialog
  shareTitle: 'Share “{name}”',
  shareLink: 'Share link',
  copyLink: 'Copy link',
  copied: 'Copied!',
  copyFailed: 'Could not copy automatically. Select the link above and copy it.',
  copyManually: 'Copy this link:',
  shareVia: 'Share…',
  shareNote: 'The whole picture is inside the link — no account or upload needed. Anyone with the link can open it.',
  shareLongUrl: 'This link is very long. Some apps may cut it — copying it into an email works best.',

  // App shell
  storageQuota: 'Browser storage is full, so changes are not saved. Export your library to keep your designs.',
  storageUnavailable: 'This browser cannot save designs. Export your library to keep them.',
  storageRecovered: 'Some saved designs could not be read. A backup copy of the old data is kept in this browser.',
  storageDamaged:
    'Saved designs could not be read and there is no room for a backup copy, so changes are not saved. Export your designs to a file.',
  storageNewerVersion: 'Your designs were saved by a newer version of SquareMath. Reload the page: changes made here are not saved.',
  exportLibrary: 'Export',
  exportLibraryHint: 'Save all your designs to a .json file',
  notFoundTitle: 'Design not found',
  notFoundText: 'This design is not in your library on this device. It may have been deleted.',
  brokenLinkTitle: 'This link is broken',
  brokenLinkText: 'The shared link seems incomplete or damaged. Ask for the link again, and make sure it is copied in full.',
  errorTitle: 'Oops! Something went wrong',
  errorText: 'This page could not be shown. Try reloading, or go back home.',
  reload: 'Reload',
};
export default dict;
