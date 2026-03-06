/* eslint-disable prettier/prettier */
import type { MenuProps } from 'antd';
import { signal } from "@preact/signals-react";

// THEME

export enum THEME {
  DARK = 'dark',
  LIGHT = 'light',
}

export const appTheme = signal(THEME.LIGHT);

export function toggleTheme() {
  appTheme.value = appTheme.value === THEME.LIGHT ? THEME.DARK : THEME.LIGHT;
}

// MENU ITEMS

export type MenuItem = Required<MenuProps>['items'][number];

export function getMenuItem(
    label: React.ReactNode,
    key: React.Key,
    icon?: React.ReactNode,
    children?: MenuItem[],
    type?: 'group',
  ): MenuItem {
    return {
      key,
      icon,
      children,
      label,
      type,
    } as MenuItem;
}

