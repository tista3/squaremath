import { afterEach, describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor, shouldIgnoreShortcut } from './tools';

describe('shortcutFor', () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    shortcutFor({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it('maps tools, colours and history', () => {
    expect(k('b')).toEqual({ kind: 'tool', tool: 'pencil' });
    expect(k('P')).toEqual({ kind: 'tool', tool: 'pencil' });
    expect(k('e')).toEqual({ kind: 'tool', tool: 'eraser' });
    expect(k('g')).toEqual({ kind: 'tool', tool: 'fill' });
    expect(k('i')).toEqual({ kind: 'tool', tool: 'picker' });
    expect(k('3')).toEqual({ kind: 'color', index: 2 });
    expect(k(']')).toEqual({ kind: 'cycle', step: 1 });
    expect(k('z', { ctrlKey: true })).toEqual({ kind: 'undo' });
    expect(k('Z', { metaKey: true, shiftKey: true })).toEqual({ kind: 'redo' });
    expect(k('y', { ctrlKey: true })).toEqual({ kind: 'redo' });
    expect(k('0')).toBeNull();
    expect(k('b', { ctrlKey: true })).toBeNull();
    expect(k('e', { altKey: true })).toBeNull();
  });
});

describe('shouldIgnoreShortcut', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const make = (html: string) => {
    document.body.innerHTML = html;
    return document.body;
  };

  it('allows shortcuts on ordinary page content', () => {
    const root = make('<button id="b">x</button>');
    expect(shouldIgnoreShortcut({ target: root.querySelector('#b') })).toBe(false);
    expect(shouldIgnoreShortcut({ target: document.body })).toBe(false);
  });
  it('ignores typing in form controls', () => {
    const root = make('<input id="i"><textarea id="t"></textarea>');
    expect(isTypingTarget(root.querySelector('#i'))).toBe(true);
    expect(isTypingTarget(root.querySelector('#t'))).toBe(true);
  });
  it('ignores keys inside a native <dialog> (no role attribute) and while one is open', () => {
    const root = make('<dialog id="d" open><button id="b">Close</button></dialog><button id="out">x</button>');
    expect(isTypingTarget(root.querySelector('#b'))).toBe(true);
    expect(shouldIgnoreShortcut({ target: root.querySelector('#out') })).toBe(true);
    expect(shouldIgnoreShortcut({ target: document.body })).toBe(true);
  });
  it('ignores keys while an aria-modal overlay is shown', () => {
    make('<div aria-modal="true" role="dialog"></div>');
    expect(shouldIgnoreShortcut({ target: document.body })).toBe(true);
  });
  it('allows shortcuts again once the dialog is closed', () => {
    const root = make('<dialog></dialog><button id="out">x</button>');
    expect(shouldIgnoreShortcut({ target: root.querySelector('#out') })).toBe(false);
  });
});
