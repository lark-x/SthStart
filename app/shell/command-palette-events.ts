export const OPEN_COMMAND_PALETTE = 'sthstart:open-command-palette';

export function openCommandPalette(invoker?: HTMLElement | null) {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE, { detail: invoker }));
}
