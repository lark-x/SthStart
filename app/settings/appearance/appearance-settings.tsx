'use client';

import { useState, type CSSProperties } from 'react';
import { Compass, BookOpen, Palette } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Dialog } from '@/app/components/ui/dialog';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { AccentColorDialog } from '@/app/shell/accent-color-dialog';
import { useTheme } from '@/app/providers/ui-provider';
import { THEMES, UI_SKINS, deriveCustomAccent, type ThemeId, type UiSkinId } from '@/app/lib/theme-preference';
import styles from './appearance.module.css';

type Preview = { kind: 'theme'; id: ThemeId } | { kind: 'skin'; id: UiSkinId };

export function AppearanceSettings() {
  const { themeId, uiSkin, accentColor, setThemeId, setUiSkin } = useTheme();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accentOpen, setAccentOpen] = useState(false);
  const sampleTheme = preview?.kind === 'theme' ? preview.id : themeId;
  const sampleSkin = preview?.kind === 'skin' ? preview.id : uiSkin;
  const name = preview?.kind === 'theme'
    ? THEMES.find((theme) => theme.id === preview.id)?.name
    : UI_SKINS.find((skin) => skin.id === sampleSkin)?.name;
  const accent = accentColor ? {
    '--custom-accent-light': deriveCustomAccent(accentColor, false),
    '--custom-accent-dark': deriveCustomAccent(accentColor, true),
  } as CSSProperties : undefined;

  return (
    <PageContainer width="settings" className="space-y-4">
      <PageHeader
        compact
        title="外观"
        description="先看预览，满意后再应用到工作区。"
        actions={
          <Button size="sm" variant="outline" onClick={() => setAccentOpen(true)}>
            <Palette className="h-3.5 w-3.5" aria-hidden="true" />
            自定义主题色
          </Button>
        }
      />

      <section aria-labelledby="appearance-theme" className="tpl-panel space-y-3 p-4">
        <h2 id="appearance-theme" className="text-base font-semibold text-ink">主题</h2>
        <ul className="divide-y divide-border-subtle">
          {THEMES.map((theme) => (
            <li key={theme.id} className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {theme.name}
                  {theme.id === themeId && <Badge>使用中</Badge>}
                </p>
                <p className="mt-1 text-sm text-muted">{theme.description}</p>
              </div>
              <Button className="shrink-0" size="sm" variant="outline" aria-label={`预览${theme.name}`} onClick={() => setPreview({ kind: 'theme', id: theme.id })}>预览</Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="appearance-skin" className="tpl-panel space-y-3 p-4">
        <h2 id="appearance-skin" className="text-base font-semibold text-ink">皮肤</h2>
        <ul className="divide-y divide-border-subtle">
          {UI_SKINS.map((skin) => (
            <li key={skin.id} className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {skin.name}
                  {skin.id === uiSkin && <Badge>使用中</Badge>}
                </p>
                <p className="mt-1 text-sm text-muted">{skin.description}</p>
              </div>
              <Button className="shrink-0" size="sm" variant="outline" aria-label={`预览${skin.name}`} onClick={() => setPreview({ kind: 'skin', id: skin.id })}>预览</Button>
            </li>
          ))}
        </ul>
      </section>

      {accentOpen && <AccentColorDialog onClose={() => setAccentOpen(false)} />}
      <Dialog open={Boolean(preview)} onOpenChange={() => setPreview(null)} title={`预览${name ? `：${name}` : ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPreview(null)}>取消</Button>
            <Button variant="primary" onClick={() => {
              if (preview?.kind === 'theme') setThemeId(preview.id);
              else if (preview) setUiSkin(preview.id);
              setPreview(null);
            }}>应用</Button>
          </>
        }>
        <div className={styles.sample} data-appearance-preview="" data-theme={sampleTheme}
          data-color-mode={sampleTheme.startsWith('dark') ? 'dark' : 'light'}
          data-ui-skin={sampleSkin === 'default' ? undefined : sampleSkin}
          data-custom-accent={accentColor ?? undefined} style={accent}>
          <div className={styles.nav}>
            <span>SthStart</span>
            <span className={styles.active}><Compass size={14} aria-hidden /> 作品</span>
            <span><BookOpen size={14} aria-hidden /> 资料库</span>
          </div>
          <div className={styles.paper}>
            <div className={styles.card}>
              <p className="font-semibold">海边小镇</p>
              <p className={styles.body}>潮水退去，码头亮起第一盏灯。</p>
              <span className={styles.action}>继续创作</span>
            </div>
          </div>
        </div>
      </Dialog>
    </PageContainer>
  );
}
