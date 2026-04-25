import React from 'react';
import {Text as RNText, type TextProps} from 'react-native';

/**
 * App-wide `<Text>` wrapper that defaults `selectable={true}`.
 *
 * Why a wrapper and not `Text.defaultProps`?
 *
 * The Flow macOS app is built with Fabric / New Architecture
 * (`RCT_NEW_ARCH_ENABLED=1`). On Fabric, host-component props flow through
 * codegen'd C++ shadow nodes, and `Text.defaultProps = {...}` is silently
 * ignored for native components — we *must* pass `selectable` explicitly on
 * each `<Text>` element, or Cmd+C / click-drag-select won't work on any label
 * in the app.
 *
 * Importing this module's `Text` everywhere (instead of from 'react-native')
 * lets us set that default in one place. Individual usages can still opt out
 * with `selectable={false}` — we do that for icon-as-glyph Text (e.g. the chat
 * Send button arrow) so those still feel like buttons rather than text.
 */
export function Text(props: TextProps) {
  return <RNText selectable {...props} />;
}

export type {TextProps};
