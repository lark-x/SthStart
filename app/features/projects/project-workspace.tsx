"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from 'next/navigation';
import { projectReturnHref } from './list-state';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, BookOpen, Film } from "lucide-react";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Dialog } from "@/app/components/ui/dialog";
import { PageTabs } from "@/app/components/ui/page-tabs";
import { KnowledgePicker } from "@/app/features/knowledge/components/knowledge-picker";
import { storyApi } from "@/app/features/story/api";
import { useActivityPage } from '@/app/features/activities/use-activity-page';
import { Pagination } from '@/app/components/ui/pagination';
import { CreatePublicationDialog } from "@/app/features/story/components/create-publication-dialog";
import {
  natureLabels,
  authorshipLabels,
} from "@/app/features/notebook/schemas";
import { projectsApi } from "./api";
import { publishedCharacterInput } from './published-character';
import { CharacterPagination, useCharacterBrowser } from '@/app/features/characters/components/character-filters';
import { projectKeys, storyKeys } from '@/app/lib/query-keys';

const linkClass = "text-sm font-medium text-accent hover:underline";
const kinds: Record<string, string> = {
  outline: "大纲",
  chapter: "章节",
  world: "世界设定",
  scene: "场景",
  note: "笔记",
  narrative: "原作文本",
  topic: "灵感素材",
  collection: "搜集资料",
};
export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const returnHref = projectReturnHref(searchParams.get('returnTo'));
  const client = useQueryClient();
  const query = useQuery({
    queryKey: projectKeys.overview(projectId),
    queryFn: () => projectsApi.overview(projectId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [tab, setTab] = useState("writing");
  const [picker, setPicker] = useState(false);
  const [publication, setPublication] = useState(false);
  const [dialog, setDialog] = useState<"character" | "activity" | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const library = useCharacterBrowser({}, dialog === 'character');
  const [activityFilter, setActivityFilter] = useState({q: '', page: 1, pageSize: 20});
  const activities = useActivityPage({...activityFilter, independent: true}, dialog === 'activity');
  const mutate = async (action: () => Promise<unknown>, success = "已保存") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: projectKeys.all });
      await client.invalidateQueries({ queryKey: storyKeys.scope(projectId) });
      setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const editor = (entry?: string) =>
    "/apps/story/" +
    projectId +
    (entry ? "?entry=" + encodeURIComponent(entry) : "");
  if (query.isLoading)
    return (
      <p className="p-8" role="status">
        正在读取项目…
      </p>
    );
  if (!query.data)
    return (
      <div className="space-y-4 p-8">
        <p role="alert">
          {query.error instanceof Error ? query.error.message : "项目不存在"}
        </p>
        <Link href={returnHref}>返回创作项目</Link>
        <Button onClick={() => void query.refetch()}>重试</Button>
      </div>
    );
  const { project, documents, characters, links, productions } = query.data;
  const references = links.filter(
    (l) => l.kind !== "artifact" && l.kind !== "activity",
  );
  const media = links.filter((l) => l.kind === "artifact");
  const chapters = documents.filter((d) => d.kind === "chapter");
  const addCharacter = async () => {
    const c = library.data?.items.find((c) => c.id === selected);
    if (!c?.latestVersion) throw new Error("请先在角色库发布角色版本。");
    if (
      characters.some(
        (existing) =>
          existing.sourceCharacterId === c.id &&
          existing.sourceVersion === c.latestVersion,
      )
    )
      throw new Error("这个角色版本已经加入项目。");
    await storyApi.createCharacter(projectId, await publishedCharacterInput(c));
    setDialog(null);
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-6 lg:p-8">
      <Link
        href={returnHref}
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={16} />
        创作项目
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-ink">{project.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {project.summary ||
              "从大纲与正文开始，逐步加入角色、参考资料和制作版本。"}
          </p>
        </div>
        <Link
          href={editor()}
          className={buttonVariants({ variant: "primary" })}
        >
          <BookOpen size={16} />
          继续写作
        </Link>
      </header>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border-subtle py-4 text-sm text-muted">
        <span>{chapters.length} 个章节</span>
        <span>{characters.length} 个角色版本</span>
        <span>{references.length} 条参考资料</span>
        <span>{productions.length} 个制作版本</span>
        <span>{media.length} 个媒体引用</span>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-bg p-3 text-sm text-danger-fg"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      <PageTabs
        ariaLabel="项目内容"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "writing", label: "正文与设定", panelId: "project-panel" },
          {
            id: "characters",
            label: "角色",
            count: characters.length,
            panelId: "project-panel",
          },
          {
            id: "references",
            label: "参考资料",
            count: references.length,
            panelId: "project-panel",
          },
          {
            id: "production",
            label: "制作",
            count: productions.length,
            panelId: "project-panel",
          },
          {
            id: "media",
            label: "媒体",
            count: media.length,
            panelId: "project-panel",
          },
        ]}
      />
      <section
        id="project-panel"
        role="tabpanel"
        aria-label={
          {
            writing: "正文与设定",
            characters: "角色",
            references: "参考资料",
            production: "制作",
            media: "媒体",
          }[tab]
        }
        className="space-y-6"
      >
        {tab === "writing" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">
                这里的正文与设定是本项目的正式内容。编辑器中保留各次修订。
              </p>
              <Link href={editor()} className={linkClass}>
                打开写作工作区 <ArrowRight className="inline" size={16} />
              </Link>
            </div>
            <div className="divide-y divide-border-subtle">
              {documents.map((d) => (
                <Link
                  key={d.id}
                  href={editor(d.id)}
                  className="flex items-center gap-4 py-4 hover:bg-surface-hover"
                >
                  <span className="w-20 shrink-0 text-xs text-muted">
                    {kinds[d.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium text-ink">{d.title}</h2>
                    <p className="mt-1 line-clamp-1 text-sm text-muted">
                      {d.body.replace(/[#*\n]/g, " ").slice(0, 120) ||
                        "尚未填写内容"}
                    </p>
                  </div>
                  <span className="text-xs text-muted">修订 {d.revision}</span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
            {!chapters.length && (
              <p className="text-sm text-muted">
                先在写作工作区新建章节。保存正文后，就可以创建制作版本。
              </p>
            )}
          </>
        )}
        {tab === "characters" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">
                采用已发布的角色版本；项目内的设定调整独立保存。
              </p>
              <Button
                onClick={() => {
                  setDialog("character");
                  setSelected("");
                  library.reset();
                }}
              >
                从角色库加入
              </Button>
            </div>
            {!characters.length && (
              <Empty text="还没有项目角色。从角色库加入，或在写作工作区创建本项目角色。" />
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {characters.map((c) => (
                <article
                  key={c.id}
                  className="space-y-3 rounded-xl border border-border-subtle p-5"
                >
                  <h2 className="font-semibold">{c.name}</h2>
                  <p className="text-sm text-muted">
                    {c.sourceCharacterId
                      ? "采用角色库版本 v" + c.sourceVersion
                      : "本项目原创角色"}
                  </p>
                  {c.latestSourceVersion &&
                  c.sourceVersion &&
                  c.latestSourceVersion > c.sourceVersion ? (
                    <p className="text-sm text-warning-fg">
                      角色库已有 v{c.latestSourceVersion}；当前项目保留 v
                      {c.sourceVersion}。
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-4">
                    <Link href={editor(c.id)} className={linkClass}>
                      编辑项目设定
                    </Link>
                    {c.sourceCharacterId && (
                      <Link
                        href={"/apps/characters/" + c.sourceCharacterId}
                        className={linkClass}
                      >
                        查看来源
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "references" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">
                参考内容保留采用时的快照。将资料采用为设定后，再按创作意图编辑。
              </p>
              <Button onClick={() => setPicker(true)}>
                <Plus size={16} />
                添加参考资料
              </Button>
            </div>
            {!references.length && (
              <Empty text="还没有参考资料。可以从资料库中挑选笔记与原作文本。" />
            )}
            <div className="space-y-4">
              {references.map((l) => (
                <article
                  key={l.id}
                  className="rounded-xl border border-border-subtle p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="font-semibold">{l.title}</h2>
                      <p className="mt-2 text-xs text-muted">
                        {kinds[l.kind]} ·{" "}
                        {natureLabels[l.nature as keyof typeof natureLabels] ??
                          l.nature}{" "}
                        ·{" "}
                        {authorshipLabels[
                          l.authorship as keyof typeof authorshipLabels
                        ] ?? l.authorship}
                        {l.sourceVersion ? " · " + l.sourceVersion : ""} ·{" "}
                        {l.usage === "requirement" ? "本次要求" : "背景参考"}
                      </p>
                    </div>
                    <span className="text-xs text-muted">
                      {l.state === "updated"
                        ? "来源已更新，项目保留旧快照"
                        : l.state === "missing"
                          ? "来源不可用，快照仍保留"
                          : "来源未变化"}
                    </span>
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-muted">
                      查看采用时的内容{l.truncated ? "（节选）" : ""}
                    </summary>
                    <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-7">
                      {l.excerpt}
                    </p>
                  </details>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link href={l.sourceHref} className={linkClass}>
                      查看来源
                    </Link>
                    {l.adoptedEntryId ? (
                      <Link
                        href={editor(l.adoptedEntryId)}
                        className={linkClass}
                      >
                        编辑已采用的设定
                      </Link>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              () => projectsApi.adopt(projectId, l.id),
                              "已生成项目设定，并保留来源",
                            )
                          }
                        >
                          采用为设定
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              () => projectsApi.unlink(projectId, l.id),
                              "已移除引用，原资料保留",
                            )
                          }
                        >
                          移除引用
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "production" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-2xl text-sm text-muted">
                制作版本冻结已保存的章节修订，用于分镜、漫画与配音视频。导出成品在各制作工作区查看。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDialog("activity");
                    setSelected("");
                  }}
                >
                  关联已有制作
                </Button>
                <Button
                  variant="primary"
                  disabled={!chapters.length}
                  onClick={() => setPublication(true)}
                >
                  <Film size={16} />
                  创建制作版本
                </Button>
              </div>
            </div>
            {!productions.length && (
              <Empty
                text={
                  chapters.length
                    ? "还没有制作版本。选择章节，开始第一次制作。"
                    : "先写好并保存一个章节，再创建制作版本。"
                }
              />
            )}
            <div className="divide-y divide-border-subtle">
              {productions.map((p) => (
                <Link
                  key={p.id}
                  href={"/apps/activities/" + p.id}
                  className="flex items-center justify-between gap-4 py-5 hover:bg-surface-hover"
                >
                  <div>
                    <h2 className="font-semibold">{p.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {p.type === "publication"
                        ? "章节制作版本"
                        : "独立互动制作 · 已关联"}
                    </p>
                  </div>
                  <ArrowRight size={18} />
                </Link>
              ))}
            </div>
          </>
        )}
        {tab === "media" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">
                项目引用的媒体保留原业务来源。可以在媒体库中选择并加入项目。
              </p>
              <Link
                href="/apps/media"
                className={buttonVariants({ variant: "outline" })}
              >
                打开媒体库
              </Link>
            </div>
            {!media.length && (
              <Empty text="还没有媒体引用。到媒体库选择作品，再点击“加入项目”。" />
            )}
            <div className="divide-y divide-border-subtle">
              {media.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-4 py-4"
                >
                  <div>
                    <h2 className="font-medium">{m.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {m.state === "missing" ? "文件暂不可用" : "已引用媒体"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={m.sourceHref} className={linkClass}>
                      查看媒体
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () => projectsApi.unlink(projectId, m.id),
                          "已移除媒体引用",
                        )
                      }
                    >
                      移除引用
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      <KnowledgePicker
        open={picker}
        onOpenChange={setPicker}
        onAdd={(selections) =>
          void mutate(async () => {
            for (const { item, usage } of selections)
              await projectsApi.add(projectId, {
                kind: item.kind,
                id: item.id,
                usage,
              });
          }, "资料已加入项目")
        }
      />
      <CreatePublicationDialog
        open={publication}
        onOpenChange={setPublication}
        projectId={projectId}
        chapters={chapters}
        flush={async () => true}
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={dialog === "character" ? "从角色库加入" : "关联已有制作"}
      >
        <div className="space-y-4">
          {dialog === "character" ? (
            <>
              <p className="text-sm text-muted">
                只采用已发布版本。角色名相同也按来源 ID 区分。
              </p>
              <Input
                aria-label="筛选角色"
                placeholder="搜索角色名称"
                value={library.filter.q ?? ''}
                onChange={(e) => { setSelected(''); library.change({ q: e.target.value }); }}
              />
              {library.isLoading && <p>正在读取角色…</p>}
              {library.isError && <div role="alert">角色读取失败：{library.error.message}<Button variant="outline" disabled={library.isFetching} onClick={() => void library.refetch()}>重新读取角色</Button></div>}
              {(library.isPlaceholderData || library.isSearchPending) && <p role="status">正在更新角色列表…</p>}
              <Select
                aria-label="选择角色版本"
                className="w-full"
                value={selected}
                disabled={library.isFetching || library.isSearchPending}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">选择已发布角色</option>
                {library.data?.items
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.latestVersion}>
                      {c.displayName} ·{" "}
                      {c.latestVersion ? "v" + c.latestVersion : "尚未发布"} ·{" "}
                      {c.id.slice(0, 6)}
                    </option>
                  ))}
              </Select>
              {library.isSuccess && !library.isPlaceholderData && !library.isSearchPending && !library.data.items.length && <p role="status">没有匹配的角色，可换一个关键词。</p>}
              <CharacterPagination data={library.data} loading={library.isFetching || library.isSearchPending}
                onPage={page => { setSelected(''); library.change({ page }); }}
                onPageSizeChange={pageSize => { setSelected(''); library.change({ pageSize }); }} />
            </>
          ) : (
            <>
              {activities.isLoading && <p>正在读取制作…</p>}
              <Input aria-label="搜索独立制作" placeholder="搜索全部独立制作" value={activityFilter.q} onChange={e => { setSelected(''); setActivityFilter({...activityFilter, q: e.target.value, page: 1}); }} />
              {activities.isFetching && <p role="status">正在更新制作列表…</p>}
              {activities.isError && <p role="alert">制作读取失败。<Button onClick={() => void activities.refetch()}>重新读取</Button></p>}
              <Select
                aria-label="选择已有制作"
                disabled={activities.isFetching || activities.isError}
                className="w-full"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">{activities.isFetching ? '正在更新…' : '选择独立制作'}</option>
                {activities.data?.items
                  .filter(
                    (a) =>
                      a.type !== "publication",
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id} disabled={productions.some(p => p.id === a.id)}>
                      {a.title}{productions.some(p => p.id === a.id) ? ' · 已关联' : ''}
                    </option>
                  ))}
              </Select>
              <Pagination compact total={activities.data?.total ?? 0} page={activities.data?.page ?? activityFilter.page} pageSize={activityFilter.pageSize} loading={activities.isFetching} onPageChange={page => {setSelected(''); setActivityFilter({...activityFilter, page});}} onPageSizeChange={pageSize => {setSelected(''); setActivityFilter({...activityFilter, page: 1, pageSize});}} />
              <p className="text-sm text-muted">
                章节制作版本自动属于其来源项目；这里关联独立创建的互动制作。
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-danger-fg">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            loading={busy}
            disabled={!selected || (dialog === 'character' && (library.isFetching || library.isSearchPending)) || (dialog === 'activity' && (activities.isFetching || activities.isError))}
            onClick={() =>
              void mutate(async () => {
                if (dialog === "character") await addCharacter();
                else {
                  await projectsApi.add(projectId, {
                    kind: "activity",
                    id: selected,
                  });
                  setDialog(null);
                }
              })
            }
          >
            确认加入
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="border-y border-dashed border-border-subtle px-6 py-16 text-center text-sm text-muted">
      {text}
    </div>
  );
}
