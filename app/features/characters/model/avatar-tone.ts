/**
 * Missing portraits should still be recognizable in a library grid.
 * Derive a stable semantic tone from the display name so the same character
 * keeps the same badge colour across pages, sessions and devices.
 */
export const AVATAR_TONES = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'] as const;

export type AvatarTone = (typeof AVATAR_TONES)[number];

export function pickAvatarTone(name: string): AvatarTone {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}
