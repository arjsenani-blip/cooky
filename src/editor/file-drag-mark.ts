/**
 * The app mark in the status bar's bottom-right corner: a drag
 * handle for the focused document's file. Drag it into Slack, Mail,
 * Teams, Finder or Explorer and the OS receives the saved file — the
 * cross-platform counterpart of the macOS title-bar proxy icon (which
 * Windows and Linux lack). A click reveals the file in the file manager.
 *
 * Desktop only: the web build has no file paths, so the mark stays
 * hidden there (and on a packaged shell too old to start a native drag).
 * Dimmed while the focused doc has no file on disk — untitled, a
 * recovered draft, the home screen — because what travels is the file
 * as saved.
 *
 * The drag itself is Electron's `webContents.startDrag`, which must be
 * triggered from the renderer's own `dragstart` (see `host:drag-file-out`
 * in main.ts); the mark image doubles as the drag icon (Windows insists
 * on one).
 */

/** The app icon (apps/desktop/build/icon.png) at 48px: the status-bar
 *  glyph and the drag icon. */
export const FILE_MARK_DATA_URL =
  'data:image/png;base64,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';

export interface FileDragHost {
  /** False on a packaged shell whose preload predates the drag surface. */
  canDragFileOut(): boolean;
  dragFileOut(path: string, iconDataUrl: string): void;
  showItemInFolder?(path: string): Promise<void>;
}

export interface FileDragMarkState {
  hidden: boolean;
  /** Shown but dimmed and inert: no file on disk to hand out. */
  inert: boolean;
  title: string;
}

export const DRAG_TITLE = 'Drag to share this file · Click to show it in its folder';
export const INERT_TITLE = 'Save the document to share its file from here';

/** Pure: what the mark should show for a host + the focused doc's handle
 *  (the absolute path on desktop; null when there is no file). */
export function fileDragMarkState(host: FileDragHost | null, handle: unknown): FileDragMarkState {
  if (!host || !host.canDragFileOut()) return { hidden: true, inert: true, title: '' };
  const path = typeof handle === 'string' && handle.length > 0 ? handle : null;
  return path
    ? { hidden: false, inert: false, title: DRAG_TITLE }
    : { hidden: false, inert: true, title: INERT_TITLE };
}

/** Wire the mark element. Returns the sync function the window-title
 *  path calls with the focused doc's handle on every identity change. */
export function installFileDragMark(
  el: HTMLElement,
  getHost: () => FileDragHost | null,
): (handle: unknown) => void {
  let currentPath: string | null = null;
  el.style.backgroundImage = `url("${FILE_MARK_DATA_URL}")`;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    // Electron: cancel the DOM drag and start the native one from here.
    e.preventDefault();
    const host = getHost();
    if (!host || !currentPath) return;
    host.dragFileOut(currentPath, FILE_MARK_DATA_URL);
  });
  el.addEventListener('click', () => {
    const host = getHost();
    if (!host || !currentPath) return;
    void host.showItemInFolder?.(currentPath);
  });
  return (handle: unknown): void => {
    const state = fileDragMarkState(getHost(), handle);
    currentPath = state.hidden || state.inert ? null : (handle as string);
    el.hidden = state.hidden;
    if (state.inert) el.dataset['inert'] = 'true';
    else delete el.dataset['inert'];
    el.title = state.title;
    el.setAttribute('aria-label', state.title || 'Cooky');
    el.setAttribute('aria-disabled', state.inert ? 'true' : 'false');
  };
}
