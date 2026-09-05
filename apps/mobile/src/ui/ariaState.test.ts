import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ariaState, selectionState } from './ariaState';

describe('ariaState', () => {
  it('carries each state across to its ARIA prop', () => {
    expect(ariaState({ checked: true })).toEqual({ 'aria-checked': true });
    expect(ariaState({ selected: true })).toEqual({ 'aria-selected': true });
    expect(ariaState({ expanded: false })).toEqual({ 'aria-expanded': false });
    expect(ariaState({ disabled: true })).toEqual({ 'aria-disabled': true });
    expect(ariaState({ busy: true })).toEqual({ 'aria-busy': true });
    expect(ariaState({ pressed: true })).toEqual({ 'aria-pressed': true });
  });

  it('carries a whole state object at once', () => {
    expect(ariaState({ checked: false, disabled: true })).toEqual({
      'aria-checked': false,
      'aria-disabled': true,
    });
    expect(ariaState({ disabled: true, busy: true })).toEqual({
      'aria-disabled': true,
      'aria-busy': true,
    });
  });

  it('leaves out a state the control does not have', () => {
    // aria-checked="false" on a control with no checked state is a lie, so an
    // absent state stays absent rather than arriving as false.
    expect(ariaState({ selected: true })).not.toHaveProperty('aria-checked');
    expect(ariaState({})).toEqual({});
  });

  it('keeps false, which is a state and not an absence', () => {
    expect(ariaState({ selected: false, disabled: false })).toEqual({
      'aria-selected': false,
      'aria-disabled': false,
    });
  });
});

describe('selectionState', () => {
  it('describes a radio and a checkbox with checked, never selected', () => {
    // aria-selected is not supported on role="radio": assistive technology
    // drops it and the group reports no checked member at all.
    expect(selectionState('radio', true, false)).toEqual({ checked: true, disabled: false });
    expect(selectionState('checkbox', false, false)).toEqual({ checked: false, disabled: false });
    expect(ariaState(selectionState('radio', true, false))).toEqual({
      'aria-checked': true,
      'aria-disabled': false,
    });
  });

  it('describes a tab with selected, which is the attribute that role takes', () => {
    expect(selectionState('tab', true, false)).toEqual({ selected: true, disabled: false });
  });

  it('gives a plain button no selection state at all', () => {
    expect(selectionState('button', true, true)).toEqual({ disabled: true });
  });
});

/**
 * react-native-web 0.21 forwards `aria-*` but has no mapping for the
 * `accessibilityState` object, so a control setting only the React Native prop
 * renders a role with no state on the web build: the weekday picker announced
 * as seven identical unchecked boxes. Rendering every primitive would need a
 * renderer this project does not carry, so the guard is on the source instead.
 * Every `accessibilityState` in the kit is paired with the twin that survives
 * the web build, and the next one added without it fails here.
 */
describe('every accessibilityState in the kit has its ARIA twin', () => {
  const uiRoot = fileURLToPath(new URL('.', import.meta.url));

  function walk(dir: string): readonly string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path));
      else if (entry.name.endsWith('.tsx')) out.push(path);
    }
    return out;
  }

  const files = walk(uiRoot)
    .map((path) => ({ name: path.split(/[\\/]/).pop() ?? path, source: readFileSync(path, 'utf8') }))
    .filter((file) => file.source.includes('accessibilityState='));

  it('covers every primitive that reports state', () => {
    const names = files.map((file) => file.name);
    for (const expected of [
      'chip.tsx',
      'answerRow.tsx',
      'setRow.tsx',
      'disclosure.tsx',
      'button.tsx',
      'exerciseHeader.tsx',
      'stepper.tsx',
      'navItemButton.tsx',
      'skeleton.tsx',
      'chartTable.tsx',
    ]) {
      expect(names).toContain(expected);
    }
  });

  for (const file of files) {
    it(`${file.name} pairs every state with ariaState`, () => {
      const states = file.source.match(/accessibilityState=/g)?.length ?? 0;
      const arias = file.source.match(/ariaState\(/g)?.length ?? 0;
      expect(`${states} accessibilityState, ${arias} ariaState`).toBe(
        `${states} accessibilityState, ${states} ariaState`,
      );
    });
  }
});
