import { HeadlessMantineProvider } from '@mantine/core';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export function renderWithUi(markup: ReactNode): string {
  return renderToStaticMarkup(createElement(HeadlessMantineProvider, null, markup));
}
