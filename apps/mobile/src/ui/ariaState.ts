/**
 * The ARIA twin of a React Native `accessibilityState`.
 *
 * Pure and import-free, like `setRowState` and `stepperMath` beside it: the
 * rule is the part that can be wrong, and a test should not have to stand up a
 * renderer to check it.
 */

/** The state a control reports, in React Native's own `accessibilityState` shape. */
export interface A11yState {
  readonly checked?: boolean;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  /**
   * A toggle button's on/off state. ARIA has no `aria-checked` on
   * `role="button"`, so a row that toggles reports `aria-pressed` instead;
   * React Native has no `pressed` state, so the native side of such a control
   * reports `selected`.
   */
  readonly pressed?: boolean;
}

/** The same state as ARIA props, ready to spread onto a View or a Pressable. */
export interface AriaState {
  readonly 'aria-checked'?: boolean;
  readonly 'aria-pressed'?: boolean;
  readonly 'aria-selected'?: boolean;
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-disabled'?: boolean;
  readonly 'aria-busy'?: boolean;
}

/**
 * react-native-web 0.21 forwards every `aria-*` prop but has no mapping for the
 * `accessibilityState` object, so a control that sets only the React Native
 * prop renders a role carrying no state at all: seven identical unchecked boxes
 * for the weekday picker, an unselected radio for every setup answer. Both
 * props are first-class on React Native 0.71 and up and on web, so every
 * control sets both and neither platform needs a check.
 *
 * Only the keys actually present come back. An absent state is not `false`:
 * `aria-checked="false"` on a control that has no checked state is a lie.
 */
export function ariaState(state: A11yState): AriaState {
  return {
    ...(state.checked === undefined ? null : { 'aria-checked': state.checked }),
    ...(state.selected === undefined ? null : { 'aria-selected': state.selected }),
    ...(state.expanded === undefined ? null : { 'aria-expanded': state.expanded }),
    ...(state.disabled === undefined ? null : { 'aria-disabled': state.disabled }),
    ...(state.busy === undefined ? null : { 'aria-busy': state.busy }),
    ...(state.pressed === undefined ? null : { 'aria-pressed': state.pressed }),
  };
}

/** The roles a selectable control in this kit can take. */
export type SelectableRole = 'radio' | 'checkbox' | 'tab' | 'button';

/**
 * The state a selectable control reports, chosen by its role.
 *
 * ARIA is strict about which attribute belongs to which role: `role="radio"`
 * and `role="checkbox"` are described by `aria-checked` and ignore
 * `aria-selected`, while `role="tab"` is the opposite. A plain button has no
 * selection at all. Getting this wrong is silent: assistive technology drops
 * the attribute and the control reports no state whatsoever, which is how a
 * 0 to 10 soreness scale ends up announcing eleven identical radios.
 */
export function selectionState(
  role: SelectableRole,
  selected: boolean,
  disabled: boolean,
): A11yState {
  switch (role) {
    case 'radio':
    case 'checkbox':
      return { checked: selected, disabled };
    case 'tab':
      return { selected, disabled };
    case 'button':
      return { disabled };
  }
}

/**
 * `aria-describedby` and `aria-invalid`, which neither React Native's prop
 * table nor react-native-web's forwarded set will produce on their own.
 */
export interface DescribedProps {
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
}

/**
 * Ties a field to its own helper or error line.
 *
 * `accessibilityHint` looks like the right prop and is not: react-native-web
 * 0.21 does not forward it, so on the web build the message is rendered, given
 * an id, and then referenced by nothing. A keyboard user who tabs back into an
 * invalid field hears the label and the value and never the reason.
 */
export function describedBy(invalid: boolean, messageId: string | null): DescribedProps {
  return {
    ...(messageId === null ? null : { 'aria-describedby': messageId }),
    ...(invalid ? { 'aria-invalid': true } : null),
  };
}
