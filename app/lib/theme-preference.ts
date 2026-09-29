export type ThemeMode = 'warm' | 'neutral';

/** New preference wins; the legacy boolean is read only during migration. */
export function readThemeMode(getItem: (key: string) => string | null): ThemeMode {
  const current = getItem('sthstart_theme');
  if (current === 'warm' || current === 'neutral') return current;

  const legacy = getItem('sthstart_eye_care_mode');
  if (legacy === 'true') return 'warm';
  if (legacy === 'false') return 'neutral';
  return 'warm';
}

export function applyThemeMode(
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  mode: ThemeMode,
) {
  root.setAttribute('data-theme', mode);
  // Keep the old selector available to downstream extensions during the UI migration.
  if (mode === 'warm') root.setAttribute('data-eye-care', 'true');
  else root.removeAttribute('data-eye-care');
}

/** Runs before first paint so CSS and the hydrated provider use the same migration rule. */
export const THEME_BOOTSTRAP_SCRIPT = `try{var n=localStorage.getItem('sthstart_theme');var o=localStorage.getItem('sthstart_eye_care_mode');var t=n==='warm'||n==='neutral'?n:o==='false'?'neutral':'warm';document.documentElement.setAttribute('data-theme',t);if(t==='warm'){document.documentElement.setAttribute('data-eye-care','true')}else{document.documentElement.removeAttribute('data-eye-care')}}catch(e){document.documentElement.setAttribute('data-theme','warm');document.documentElement.setAttribute('data-eye-care','true')}`;
