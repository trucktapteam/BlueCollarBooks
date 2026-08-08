/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#ffffff',
    background: '#111111',
    backgroundElement: '#1d1d1d',
    backgroundSelected: '#262626',
    textSecondary: '#b8b8b8',
  },
  dark: {
    text: '#ffffff',
    background: '#111111',
    backgroundElement: '#1d1d1d',
    backgroundSelected: '#262626',
    textSecondary: '#b8b8b8',
  },
} as const;

export const BrandColors = {
  background: '#111111',
  card: '#1d1d1d',
  cardRaised: '#242424',
  field: '#252525',
  border: '#343434',
  borderSubtle: '#2b2b2b',
  orange: '#ff7a00',
  orangeSoft: 'rgba(255, 122, 0, 0.14)',
  orangeBorder: 'rgba(255, 122, 0, 0.42)',
  blue: '#1e88e5',
  green: '#43a047',
  red: '#c62828',
  white: '#ffffff',
  label: '#c7c7c7',
  muted: '#8f8f8f',
  black: '#111111',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
