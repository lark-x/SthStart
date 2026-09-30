'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Sparkles,
  Users,
  Compass,
  ArrowRight,
  Layers,
  Check,
  Plus,
  Loader2,
  FileText,
} from 'lucide-react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { storyApi } from '@/app/features/story/api';
import { fetchCharacters } from '@/app/features/characters/api';
import { createActivity } from '@/app/features/activities/api';
import { PlanningWizard } from '@/app/features/activities/components/planning-wizard';

type EntryMode = 'quick' | 'wizard';
type QuickTab = 'story' | 'character' | 'blank';

export function NewActivityEntry() {
  const router = useRouter();
  const [entryMode, setEntryMode] = useState<EntryMode>('quick');
  const [quickTab, setQuickTab] = useState<QuickTab>('story');

  // 小说项目与章节派生状态
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState('');

  // 快速角色创建状态
  const [customTitle, setCustomTitle] = useState('');
  const [customTheme, setCustomTheme] = useState('');
  const [selectedActorNames, setSelectedActorNames] = useState<string[]>([]);
  const [quickCreating, setQuickCreating] = useState(false);
  const [quickError, setQuickError] = useState('');

  // 数据查询
  const projectsQuery = useQuery({
    queryKey: ['story', 'projects-for-derive'],
    queryFn: () => storyApi.listProjects(),
    staleTime: 30_000,
  });

  const documentsQuery = useQuery({
    queryKey: ['story', selectedProjectId, 'documents-for-derive'],
    queryFn: () => storyApi.listDocuments(selectedProjectId),
    enabled: Boolean(selectedProjectId),
    staleTime: 30_000,
  });

  const charactersQuery = useQuery({
    queryKey: ['characters', 'all-for-activity-new'],
    queryFn: () => fetchCharacters(),
    staleTime: 60_000,
  });

  const projects = projectsQuery.data?.items ?? [];
  const chapters = (documentsQuery.data?.items ?? []).filter((d) => d.kind === 'chapter' || d.kind === 'outline');
  const allCharacters = charactersQuery.data?.items ?? [];

  // 1. 从小说章节派生创建
  const handleDeriveFromStory = async () => {
    if (!selectedProjectId || !selectedChapterId || deriving) return;
    setDeriving(true);
    setDeriveError('');
    try {
      const project = projects.find((p) => p.id === selectedProjectId);
      const chapter = chapters.find((c) => c.id === selectedChapterId);
      if (!chapter) throw new Error('未找到所选章节喵');

      // 提取章节中的对话角色（剥离表情动作括号）
      const detectedActors = (chapter.body.match(/^([^\n:：]{1,20})[:：]/gm) || [])
        .map((s) => s.replace(/[:：]/g, '').replace(/（[^）]*）|\([^)]*\)/g, '').trim())
        .filter((v, i, a) => v.length > 0 && a.indexOf(v) === i);

      const actors = (detectedActors.length > 0 ? detectedActors : ['主角', '伙伴']).map((name) => ({
        displayName: name,
        activityRole: '登场角色',
      }));

      const res = await createActivity({
        title: `${project?.title || '小说'} · ${chapter.title}`,
        type: '视觉小说演出',
        theme: project?.title || '剧情衍生',
        location: '故事舞台',
        rules: '由纯文字小说一键编译生成，包含分幕与对白角色安排。',
        stageTitles: [`${chapter.title} · 开局`, `${chapter.title} · 发展`, `${chapter.title} · 尾声`],
        actors,
      });

      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setDeriveError(err instanceof Error ? err.message : '从小说派生失败喵');
    } finally {
      setDeriving(false);
    }
  };

  // 2. 快速角色与设定创建
  const handleQuickCreate = async () => {
    if (!customTitle.trim() || quickCreating) return;
    setQuickCreating(true);
    setQuickError('');
    try {
      const actors = (selectedActorNames.length > 0 ? selectedActorNames : ['主角']).map((name) => ({
        displayName: name,
        activityRole: '核心主角',
      }));

      const res = await createActivity({
        title: customTitle.trim(),
        type: '四幕分镜漫剧',
        theme: customTheme.trim() || '奇幻冒险',
        location: '主场景',
        rules: '四幕起承转合分镜漫剧工程。',
        stageTitles: ['第一幕 起', '第二幕 承', '第三幕 转', '第四幕 合'],
        actors,
      });

      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : '创建活动失败喵');
    } finally {
      setQuickCreating(false);
    }
  };

  // 3. 空白起步
  const handleBlankCreate = async () => {
    if (quickCreating) return;
    setQuickCreating(true);
    try {
      const res = await createActivity({
        title: '全新漫剧工坊',
        type: '分镜漫剧',
        theme: '自由创作',
        location: '舞台',
        stageTitles: ['第一场', '第二场'],
        actors: [{ displayName: '主角', activityRole: '登场角色' }],
      });
      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : '创建空白活动失败喵');
    } finally {
      setQuickCreating(false);
    }
  };

  if (entryMode === 'wizard') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-default bg-surface px-6 py-2.5">
          <span className="text-xs text-muted">当前为传统多阶段企划向导</span>
          <Button size="sm" variant="ghost" onClick={() => setEntryMode('quick')} className="text-xs">
            返回快速创建工坊
          </Button>
        </div>
        <PlanningWizard />
      </div>
    );
  }

  return (
    <PageContainer width="settings" className="space-y-6 py-6">
      <PageHeader
        title="新建多媒体视觉工坊"
        description="从小说章节直出一键漫剧，或挑选登场角色快速生成分镜与动态视听工程。"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEntryMode('wizard')}
            className="text-xs text-muted hover:text-ink gap-1"
          >
            <Compass className="size-3.5" />
            <span>切换传统企划向导</span>
          </Button>
        }
      />

      {/* 核心方式三选一导航 */}
      <div className="grid grid-cols-1 gap-2 rounded-[var(--radius-panel)] bg-surface-muted p-1 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setQuickTab('story')}
          className={`flex items-center justify-center gap-2 rounded-[var(--radius-control)] py-2.5 text-xs font-semibold transition-all ${
            quickTab === 'story'
              ? 'bg-surface text-accent shadow-xs'
              : 'text-muted hover:text-ink hover:bg-surface/50'
          }`}
        >
          <BookOpen className="size-4" />
          <span>从小说章节派生 (推荐)</span>
        </button>
        <button
          type="button"
          onClick={() => setQuickTab('character')}
          className={`flex items-center justify-center gap-2 rounded-[var(--radius-control)] py-2.5 text-xs font-semibold transition-all ${
            quickTab === 'character'
              ? 'bg-surface text-accent shadow-xs'
              : 'text-muted hover:text-ink hover:bg-surface/50'
          }`}
        >
          <Users className="size-4" />
          <span>挑选角色与题材生成</span>
        </button>
        <button
          type="button"
          onClick={() => setQuickTab('blank')}
          className={`flex items-center justify-center gap-2 rounded-[var(--radius-control)] py-2.5 text-xs font-semibold transition-all ${
            quickTab === 'blank'
              ? 'bg-surface text-accent shadow-xs'
              : 'text-muted hover:text-ink hover:bg-surface/50'
          }`}
        >
          <Layers className="size-4" />
          <span>空白画卷起步</span>
        </button>
      </div>

      {/* 方式 1：从小说章节派生 */}
      {quickTab === 'story' && (
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-border-default bg-surface p-6 shadow-xs">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              选择要视觉化的小说章节
            </h3>
            <p className="text-xs text-muted">
              系统会自动抽取小说中的分幕、角色台词与情境，一键装配为分镜漫画格与视听工坊喵。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">1. 选择所属小说工程</label>
              <select
                aria-label="选择所属小说工程"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setSelectedChapterId('');
                }}
                className="w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">-- 请选择小说工程 --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">2. 选择章节正文</label>
              <select
                aria-label="选择章节正文"
                value={selectedChapterId}
                disabled={!selectedProjectId || chapters.length === 0}
                onChange={(e) => setSelectedChapterId(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">
                  {selectedProjectId
                    ? chapters.length > 0
                      ? '-- 请选择章节 --'
                      : '该工程暂无章节'
                    : '-- 请先选择工程 --'}
                </option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === 'outline' ? `[大纲] ${c.title}` : c.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {deriveError && <p className="text-xs text-danger-fg">{deriveError}</p>}

          <div className="pt-2">
            <Button
              disabled={!selectedProjectId || !selectedChapterId || deriving}
              onClick={() => void handleDeriveFromStory()}
              className="gap-2 font-semibold"
            >
              {deriving ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              <span>一键派生并进入视觉漫剧工坊</span>
            </Button>
          </div>
        </section>
      )}

      {/* 方式 2：挑选角色与题材生成 */}
      {quickTab === 'character' && (
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-border-default bg-surface p-6 shadow-xs">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Users className="size-4 text-accent" />
              挑选出镜角色与设定
            </h3>
            <p className="text-xs text-muted">
              直接复用已清洗的 120+ 角色人设外貌与 LoRA 资产，确保 ComfyUI 生图高度一致喵。
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">漫剧工程名称</label>
              <Input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="例如：提瓦特冬日温泉物语"
                className="max-w-md"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">故事梗概或主题 (可选)</label>
              <Textarea
                rows={2}
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="例如：几人在初雪之夜围坐畅谈，偶遇神秘来客…"
                className="max-w-md"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">
                挑选登场角色 (已选 {selectedActorNames.length} 位)
              </label>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 rounded border border-border-default bg-surface-muted/40">
                {allCharacters.map((c) => {
                  const selected = selectedActorNames.includes(c.displayName);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedActorNames((prev) =>
                          selected ? prev.filter((n) => n !== c.displayName) : [...prev, c.displayName]
                        );
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-all ${
                        selected
                          ? 'bg-accent text-white font-semibold shadow-xs'
                          : 'bg-surface border border-border-default text-ink hover:border-accent'
                      }`}
                    >
                      {selected && <Check className="size-3" />}
                      <span>{c.displayName}</span>
                      {c.tags?.[0] && <span className="opacity-60 text-[10px]">· {c.tags[0]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {quickError && <p className="text-xs text-danger-fg">{quickError}</p>}

          <div className="pt-2">
            <Button
              disabled={!customTitle.trim() || quickCreating}
              onClick={() => void handleQuickCreate()}
              className="gap-2 font-semibold"
            >
              {quickCreating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              <span>创建四幕分镜工程</span>
            </Button>
          </div>
        </section>
      )}

      {/* 方式 3：空白起步 */}
      {quickTab === 'blank' && (
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-border-default bg-surface p-6 shadow-xs text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Plus className="size-6" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-ink">快速建立空白视觉工坊</h3>
            <p className="text-xs text-muted">
              不预设剧情与模板，直接进入自由分镜与漫画连环画排版画布喵。
            </p>
          </div>
          {quickError && <p className="text-xs text-danger-fg">{quickError}</p>}
          <div>
            <Button
              disabled={quickCreating}
              onClick={() => void handleBlankCreate()}
              className="gap-2 font-semibold"
            >
              {quickCreating ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              <span>直接开启空白工坊</span>
            </Button>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
