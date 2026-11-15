'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Film, Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { Badge } from '@/app/components/ui/badge';
import { Card } from '@/app/components/ui/card';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { KnowledgePicker } from '@/app/features/knowledge/components/knowledge-picker';
import { authorshipLabels, natureLabels } from '@/app/features/notebook/schemas';
import { projectsApi } from '@/app/features/projects/api';
import { projectBackTarget, projectEditorHref } from '@/app/features/projects/list-state';
import { useWorldProjectBinding } from '@/app/features/story-worlds/queries';
import { storyKeys } from '@/app/lib/query-keys';
import { projectKeys } from '@/app/features/projects/query-keys';
import { CreatePublicationDialog } from '@/app/workspaces/story/create-publication-dialog';
import { ProjectAddSourceDialog, type ProjectSourceMode } from './project-add-source-dialog';

const linkClass = 'text-sm font-medium text-accent hover:underline';
const kinds: Record<string, string> = {
  outline: '大纲',
  chapter: '章节',
  world: '世界设定',
  scene: '场景',
  note: '笔记',
  narrative: '原作文本',
  topic: '灵感素材',
  collection: '搜集资料',
};

const TAB_LABELS = {
  writing: '正文与设定',
  characters: '角色',
  references: '参考资料',
  production: '制作',
  media: '媒体',
} as const;

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const listReturn = searchParams.get('returnTo');
  const back = projectBackTarget(listReturn);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: projectKeys.overview(projectId),
    queryFn: () => projectsApi.overview(projectId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [tab, setTab] = useState<keyof typeof TAB_LABELS>('writing');
  const [picker, setPicker] = useState(false);
  const [publication, setPublication] = useState(false);
  const [publicationChapters, setPublicationChapters] = useState<string[] | undefined>(undefined);
  const [dialog, setDialog] = useState<ProjectSourceMode>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [dismissedAdoption, setDismissedAdoption] = useState('');
  const adoptedChapterId = searchParams.get('adopted') ?? '';
  const binding = useWorldProjectBinding(projectId);

  const mutate = async (action: () => Promise<unknown>, success = '已保存') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await client.invalidateQueries({ queryKey: projectKeys.all });
      await client.invalidateQueries({ queryKey: storyKeys.scope(projectId) });
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const editor = (entry?: string) => projectEditorHref(projectId, listReturn, entry);

  if (query.isLoading) {
    return (
      <PageContainer className="space-y-4">
        <PageHeader backHref={back.href} backLabel={back.label} title="创作项目" />
        <AsyncState status="loading" title="正在读取项目" rows={3} />
      </PageContainer>
    );
  }

  if (!query.data) {
    return (
      <PageContainer className="space-y-4">
        <PageHeader backHref={back.href} backLabel={back.label} title="创作项目" />
        <AsyncState
          status="error"
          title="无法打开项目"
          description={query.error instanceof Error ? query.error.message : '项目不存在'}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }

  const { project, documents, characters, links, productions } = query.data;
  const references = links.filter((link) => link.kind !== 'artifact' && link.kind !== 'activity');
  const media = links.filter((link) => link.kind === 'artifact');
  const chapters = documents.filter((document) => document.kind === 'chapter');
  const adoptedChapter = adoptedChapterId
    ? chapters.find((chapter) => chapter.id === adoptedChapterId) ?? null
    : null;
  const boundBranch = binding.data?.binding ?? null;
  const adoptionReviewOpen = Boolean(adoptedChapter) && dismissedAdoption !== adoptedChapterId;
  const activeTab = adoptionReviewOpen ? 'production' : tab;
  const publicationOpen = (publication || adoptionReviewOpen) && chapters.length > 0;
  const publicationInitialChapters = adoptionReviewOpen && adoptedChapter
    ? [adoptedChapter.id]
    : publicationChapters;

  const openPublication = (chapterIds?: string[]) => {
    setPublicationChapters(chapterIds);
    setTab('production');
    setPublication(true);
  };

  return (
    <PageContainer className="space-y-4">
      <PageHeader
        compact
        backHref={back.href}
        backLabel={back.label}
        title={project.title}
        navigation={
          <PageTabs
            variant="local"
            ariaLabel="项目内容"
            value={activeTab}
            onChange={(next) => {
              if (adoptionReviewOpen) setDismissedAdoption(adoptedChapterId);
              setTab(next as keyof typeof TAB_LABELS);
            }}
            tabs={[
              { id: 'writing', label: TAB_LABELS.writing, count: chapters.length, panelId: 'project-panel' },
              { id: 'characters', label: TAB_LABELS.characters, count: characters.length, panelId: 'project-panel' },
              { id: 'references', label: TAB_LABELS.references, count: references.length, panelId: 'project-panel' },
              { id: 'production', label: TAB_LABELS.production, count: productions.length, panelId: 'project-panel' },
              { id: 'media', label: TAB_LABELS.media, count: media.length, panelId: 'project-panel' },
            ]}
          />
        }
        actions={
          <Link href={editor()} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            <BookOpen size={16} aria-hidden="true" />
            继续写作
          </Link>
        }
      />

      {project.summary && <p className="max-w-[var(--shell-reading)] text-sm leading-relaxed text-muted">{project.summary}</p>}
      {error && <Alert variant="danger" title="操作失败" onDismiss={() => setError('')}>{error}</Alert>}
      {notice && <Alert variant="success" onDismiss={() => setNotice('')}>{notice}</Alert>}

      <section
        id="project-panel"
        role="tabpanel"
        aria-label={TAB_LABELS[activeTab]}
        className="tpl-panel space-y-4 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-border-subtle bg-surface-sunken/25 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-ink">故事世界衔接</p>
            {binding.isLoading ? (
              <p className="text-xs text-muted">正在读取世界绑定…</p>
            ) : binding.isError ? (
              <p className="text-xs text-danger-fg">世界绑定读取失败；采纳和制作不受影响。</p>
            ) : boundBranch ? (
              <p className="text-xs leading-relaxed text-muted">
                已关联世界 {boundBranch.worldId} · 分支 {boundBranch.branchId} · 绑定时修订 {boundBranch.sourceRevision}
                {' '}（绑定记录不会随分支推进自动更新）
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-muted">
                尚未关联故事世界分支。可以在故事世界中采纳事件，或先新建一个世界。
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {boundBranch && (
              <Link
                href={`/apps/story-worlds?world=${encodeURIComponent(boundBranch.worldId)}&branch=${encodeURIComponent(boundBranch.branchId)}&view=reading`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                打开关联世界分支
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
            <Link
              href={`/apps/story-worlds/new?projectId=${encodeURIComponent(projectId)}`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              新建故事世界
            </Link>
          </div>
        </div>
        {adoptedChapter && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-accent/20 bg-accent/5 px-4 py-3">
            <p className="text-sm text-ink">
              刚采纳的章节「{adoptedChapter.title}」已写入项目，可以继续编辑或创建制作版本。
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={editor(adoptedChapter.id)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                打开章节
              </Link>
              <Button size="sm" variant="primary" onClick={() => openPublication([adoptedChapter.id])}>
                用该章节创建制作版本
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissedAdoption(adoptedChapter.id)}>
                稍后处理
              </Button>
            </div>
          </div>
        )}
        {activeTab === 'writing' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">这里的正文与设定是本项目的正式内容。编辑器中保留各次修订。</p>
            </div>
            {documents.length ? (
              <ul className="divide-y divide-border-subtle">
                {documents.map((document) => (
                  <li key={document.id}>
                    <Link
                      href={editor(document.id)}
                      className="flex items-center gap-4 py-4 transition-colors hover:bg-surface-hover"
                    >
                      <Badge variant="secondary" className="w-20 shrink-0 justify-center">{kinds[document.kind]}</Badge>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate font-medium text-ink">{document.title}</h2>
                        <p className="mt-1 line-clamp-1 text-sm text-muted">
                          {document.body.replace(/[#*\n]/g, ' ').slice(0, 120) || '尚未填写内容'}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 tabular-nums">修订 {document.revision}</Badge>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={BookOpen}
                title="还没有正文或设定"
                description="先在写作工作区新建章节。保存正文后，就可以创建制作版本。"
              />
            )}
          </>
        )}

        {activeTab === 'characters' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">采用已发布的角色版本；项目内的设定调整独立保存。</p>
              <Button size="sm" onClick={() => setDialog('character')}>从角色库加入</Button>
            </div>
            {characters.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {characters.map((character) => (
                  <Card key={character.id} className="space-y-3">
                    <h2 className="font-semibold text-ink">{character.name}</h2>
                    <p className="text-sm text-muted">
                      {character.sourceCharacterId
                        ? '采用角色库版本 v' + character.sourceVersion
                        : '本项目原创角色'}
                    </p>
                    {character.latestSourceVersion && character.sourceVersion
                      && character.latestSourceVersion > character.sourceVersion ? (
                        <p className="text-sm text-warning-fg">
                          角色库已有 v{character.latestSourceVersion}；当前项目保留 v{character.sourceVersion}。
                        </p>
                      ) : null}
                    <div className="flex flex-wrap gap-4">
                      <Link href={editor(character.id)} className={linkClass}>编辑项目设定</Link>
                      {character.sourceCharacterId && (
                        <Link href={'/apps/characters/' + character.sourceCharacterId} className={linkClass}>查看来源</Link>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Plus}
                title="还没有项目角色"
                description="从角色库加入已发布版本，或在写作工作区创建本项目角色。"
              />
            )}
          </>
        )}

        {activeTab === 'references' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">参考内容保留采用时的快照。将资料采用为设定后，再按创作意图编辑。</p>
              <Button size="sm" onClick={() => setPicker(true)}><Plus size={16} aria-hidden="true" />添加参考资料</Button>
            </div>
            {references.length ? (
              <div className="space-y-4">
                {references.map((link) => (
                  <Card key={link.id}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 className="font-semibold text-ink">{link.title}</h2>
                        <p className="mt-2 text-xs text-muted">
                          {kinds[link.kind]} · {natureLabels[link.nature as keyof typeof natureLabels] ?? link.nature}
                          {' · '}{authorshipLabels[link.authorship as keyof typeof authorshipLabels] ?? link.authorship}
                          {link.sourceVersion ? ' · ' + link.sourceVersion : ''}
                          {' · '}{link.usage === 'requirement' ? '本次要求' : '背景参考'}
                        </p>
                      </div>
                      <span className="text-xs text-muted">
                        {link.state === 'updated'
                          ? '来源已更新，项目保留旧快照'
                          : link.state === 'missing'
                            ? '来源不可用，快照仍保留'
                            : '来源未变化'}
                      </span>
                    </div>
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm text-muted">
                        查看采用时的内容{link.truncated ? '（节选）' : ''}
                      </summary>
                      <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-7">{link.excerpt}</p>
                    </details>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Link href={link.sourceHref} className={linkClass}>查看来源</Link>
                      {link.adoptedEntryId ? (
                        <Link href={editor(link.adoptedEntryId)} className={linkClass}>编辑已采用的设定</Link>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void mutate(() => projectsApi.adopt(projectId, link.id), '已生成项目设定，并保留来源')}
                          >
                            采用为设定
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void mutate(() => projectsApi.unlink(projectId, link.id), '已移除引用，原资料保留')}
                          >
                            移除引用
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Plus}
                title="还没有参考资料"
                description="可以从资料库中挑选笔记与原作文本；采用后会保留来源快照。"
              />
            )}
          </>
        )}

        {activeTab === 'production' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-2xl text-sm text-muted">制作版本冻结已保存的章节修订，用于分镜、漫画与配音视频。导出成品在各制作工作区查看。</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDialog('activity')}>关联已有制作</Button>
                <Button size="sm" variant="primary" disabled={!chapters.length} onClick={() => openPublication()}>
                  <Film size={16} aria-hidden="true" />创建制作版本
                </Button>
              </div>
            </div>
            {productions.length ? (
              <ul className="divide-y divide-border-subtle">
                {productions.map((production) => (
                  <li key={production.id}>
                    <Link
                      href={'/apps/activities/' + production.id}
                      className="flex items-center justify-between gap-4 py-5 transition-colors hover:bg-surface-hover"
                    >
                      <div>
                        <h2 className="font-semibold text-ink">{production.title}</h2>
                        <p className="mt-1 text-xs text-muted">
                          {production.type === 'publication' ? '章节制作版本' : '独立互动制作 · 已关联'}
                        </p>
                      </div>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Film}
                title="还没有制作版本"
                description={chapters.length
                  ? '选择章节，开始第一次制作。'
                  : '先写好并保存一个章节，再创建制作版本。'}
              />
            )}
          </>
        )}

        {activeTab === 'media' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">项目引用的媒体保留原业务来源。可以在媒体库中选择并加入项目。</p>
              <Link href="/apps/media" className={buttonVariants({ variant: 'outline', size: 'sm' })}>打开媒体库</Link>
            </div>
            {media.length ? (
              <ul className="divide-y divide-border-subtle">
                {media.map((link) => (
                  <li key={link.id} className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <h2 className="font-medium text-ink">{link.title}</h2>
                      <p className="mt-1 text-xs text-muted">
                        {link.state === 'missing' ? '文件暂不可用' : '已引用媒体'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link href={link.sourceHref} className={linkClass}>查看媒体</Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void mutate(() => projectsApi.unlink(projectId, link.id), '已移除媒体引用')}
                      >
                        移除引用
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Plus}
                title="还没有媒体引用"
                description="到媒体库选择作品，再点击“加入项目”。"
              />
            )}
          </>
        )}
      </section>

      <KnowledgePicker
        open={picker}
        onOpenChange={setPicker}
        onAdd={(selections) => void mutate(async () => {
          for (const { item, usage } of selections) {
            await projectsApi.add(projectId, { kind: item.kind, id: item.id, usage });
          }
        }, '资料已加入项目')}
      />
      <CreatePublicationDialog
        open={publicationOpen}
        onOpenChange={(next) => {
          if (!next && adoptionReviewOpen) setDismissedAdoption(adoptedChapterId);
          setPublication(next);
        }}
        projectId={projectId}
        chapters={chapters}
        initialChapterIds={publicationInitialChapters}
        flush={async () => true}
      />
      <ProjectAddSourceDialog
        key={dialog ?? 'closed'}
        mode={dialog}
        projectId={projectId}
        overview={query.data}
        onClose={() => setDialog(null)}
        onAdded={(message) => {
          setNotice(message);
          void client.invalidateQueries({ queryKey: projectKeys.all });
          void client.invalidateQueries({ queryKey: storyKeys.scope(projectId) });
        }}
      />
    </PageContainer>
  );
}
