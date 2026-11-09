export const OPEN_COMMAND_PALETTE = 'sthstart:open-command-palette';

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE));
}
