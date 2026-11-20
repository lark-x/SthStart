"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowRight, FolderOpen } from "lucide-react";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { EmptyState } from '@/app/components/ui/empty-state';
import { Skeleton } from "@/app/components/ui/skeleton";
import { Dialog } from "@/app/components/ui/dialog";
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { FormField } from '@/app/components/ui/form-field';
import { storyApi } from "@/app/features/story/api";
import { projectsApi } from "./api";
import { projectKeys } from '@/app/lib/query-keys';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Pagination } from '@/app/components/ui/pagination';
import { Select } from '@/app/components/ui/select';
import { PROJECT_PAGE_SIZES, projectListHref, readProjectListState, type ProjectListState } from './list-state';

const PROJECT_SCROLL_PREFIX = 'project-list-scroll:';

function scrollKey(href: string) {
  return PROJECT_SCROLL_PREFIX + href;
}

function readScroll(href: string) {
  try {
    const value = Number(sessionStorage.getItem(scrollKey(href)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function ProjectSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [input, setInput] = useState({ source: value, draft: value });
  if (input.source !== value) setInput({ source: value, draft: value });
  const draft = input.source === value ? input.draft : value;
  const setDraft = (draft: string) => setInput({ source: value, draft });
  const [composing, setComposing] = useState(false);
  const callback = useRef(onSearch);
  useEffect(() => { callback.current = onSearch; }, [onSearch]);
  useEffect(() => {
    if (composing || draft.trim() === value) return;
    const timer = setTimeout(() => callback.current(draft.trim()), 350);
    return () => clearTimeout(timer);
  }, [draft, value, composing]);
  return <div className="grid w-full min-w-0 basis-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:max-w-sm sm:basis-auto">
    <Input aria-label="搜索项目" placeholder="搜索项目名称或简介" value={draft} maxLength={200}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onChange={event => setDraft(event.target.value)} />
    {draft && <Button size="sm" variant="ghost" onClick={() => { setDraft(''); callback.current(''); }}>清空</Button>}
  </div>;
}

export function ProjectList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useQueryClient();
  const state = useMemo(() => readProjectListState(searchParams), [searchParams]);
  const scrollHref = projectListHref(state);
  const query = useQuery({
    queryKey: [...projectKeys.all, 'page', state],
    queryFn: ({ signal }) => projectsApi.page(state, signal),
    placeholderData: keepPreviousData,
    staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const update = (patch: Partial<ProjectListState>) => {
    const next = { ...state, ...patch };
    if ('q' in patch || 'sort' in patch || 'pageSize' in patch) next.page = 1;
    router.push(projectListHref(next, searchParams.toString()), { scroll: false });
  };
  // Normalize bad URLs and clamp a deleted/out-of-range last page using metadata
  // from the current query. keepPreviousData can briefly expose the preceding
  // page while a new key is loading, so that placeholder must never canonicalize
  // the URL (for example, rewriting a restored pageSize=50 request to 20).
  useEffect(() => {
    // During an App Router back transition useSearchParams can briefly retain
    // the destination route's query while the browser already points at the
    // restored list. Never rewrite the list from that stale snapshot.
    if (window.location.pathname !== '/apps/projects'
      || new URLSearchParams(window.location.search).toString() !== searchParams.toString()) return;
    const page = query.data && !query.isPlaceholderData && !query.isFetching
      && query.data.pageSize === state.pageSize ? query.data.page : state.page;
    const canonical = projectListHref({ ...state, page }, searchParams.toString());
    if ('/apps/projects?' + searchParams.toString() !== canonical) router.replace(canonical, { scroll: false });
  }, [state, query.data, query.isPlaceholderData, query.isFetching, router, searchParams]);
  const ready = !!query.data && !query.isPlaceholderData && !query.isFetching
    && query.data.pageSize === state.pageSize;
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);
  // Project browsing uses the document scrollbar. Remember the exact filtered URL so
  // returning from a project and browser back/forward restore the same reading place.
  useEffect(() => {
    if (!ready) return;
    if (window.location.pathname !== '/apps/projects'
      || new URLSearchParams(window.location.search).toString() !== searchParams.toString()) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: readScroll(scrollHref), left: 0, behavior: 'auto' }));
    return () => window.cancelAnimationFrame(frame);
  }, [scrollHref, ready, searchParams]);
  useEffect(() => {
    let frame = 0;
    const save = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        try { sessionStorage.setItem(scrollKey(scrollHref), String(window.scrollY)); } catch { /* storage optional */ }
      });
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', save);
    };
  }, [scrollHref]);
  const rememberPosition = () => {
    try { sessionStorage.setItem(scrollKey(scrollHref), String(window.scrollY)); } catch { /* storage optional */ }
  };
  const [open, setOpen] = useState(() => searchParams.get("new") === "1");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const p = await storyApi.createProject(title.trim());
      await client.invalidateQueries({ queryKey: projectKeys.all });
      router.push("/apps/projects/" + p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };
  const items = query.data?.items ?? [];
  return (
    <PageContainer className="project-directory space-y-4">
      <PageHeader compact
        title="历史创作项目"
        description="剧情与设定创作已统一整合至「作品」工作台，这里仅保留历史兼容手稿入口。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/apps/story-worlds" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              前往作品目录
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus size={15} aria-hidden="true" />
              新建兼容项目
            </Button>
          </div>
        }
      />
      <section aria-label="项目列表" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3" aria-label="项目列表筛选">
        <div className="contents min-w-0 flex-1 flex-wrap items-center gap-3 sm:flex">
          <ProjectSearch value={state.q} onSearch={q => update({ q })} />
          <Select className="w-auto min-w-0 sm:min-w-36" aria-label="项目排序" value={state.sort} onChange={event => update({ sort: event.target.value as ProjectListState['sort'] })}>
            <option value="updated">最近更新</option><option value="created">最近创建</option><option value="title">名称顺序</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新列表</Button>
          <Link
            href="/apps/story-worlds"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            前往作品目录 <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <div aria-busy={query.isFetching}>
      {query.isLoading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="正在读取项目">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex min-h-40 flex-col rounded-panel bg-surface p-4 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      )}
      {query.isPlaceholderData && <p role="status" className="pb-4 text-sm text-muted">正在更新，以下为上次查询结果…</p>}
      {query.isError && !query.data && (
        <AsyncState
          status="error"
          title="项目加载失败"
          description={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isError && query.data && (
        <Alert variant="danger" title="项目列表更新失败">
          {query.error instanceof Error ? query.error.message : '请稍后重试。'}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>重试</Button>
        </Alert>
      )}
      {query.data && !query.isError && !query.isPlaceholderData && !items.length && (
        <EmptyState icon={FolderOpen}
          title={state.q ? '没有匹配的项目' : '从一个故事开始'}
          description={state.q ? '换一个关键词，或清空搜索查看全部项目。' : '点击上方「新建项目」，就可以开始整理正文、角色和参考资料。'}
          actions={state.q ? <Button size="sm" variant="outline" onClick={() => update({ q: '' })}>清空搜索</Button> : undefined}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(
          ({ project, chapters, characters, references, productions }) => (
            <Link
              key={project.id}
              href={"/apps/projects/" + project.id + '?returnTo=' + encodeURIComponent(scrollHref)}
              onClick={rememberPosition}
              className="group flex min-h-40 min-w-0 flex-col rounded-panel bg-surface p-4 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] transition-shadow hover:shadow-[var(--elev-sm),0_0_0_1px_var(--hairline)] focus-visible:outline-2 focus-visible:outline-accent"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-[length:var(--text-section)] font-semibold text-ink">
                  {project.title}
                </h2>
                <ArrowRight
                  size={18}
                  className="mt-1 shrink-0 text-muted group-hover:text-ink"
                />
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted">
                {project.summary || "尚未填写项目简介"}
              </p>
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 border-t border-border-subtle/60 pt-3 mt-4 text-xs text-muted">
                <span>{chapters} 章节</span>
                <span>{characters} 角色</span>
                <span>{references} 参考资料</span>
                <span>{productions} 制作</span>
              </div>
            </Link>
          ),
        )}
      </div>
      </div>
      {query.data && <Pagination total={query.data.total} page={query.data.page} pageSize={query.data.pageSize}
        onPageChange={page => update({ page })} onPageSizeChange={pageSize => update({ pageSize })}
        pageSizeOptions={PROJECT_PAGE_SIZES} loading={query.isFetching || query.isPlaceholderData} />}
      </section>
      <Dialog open={open} onOpenChange={setOpen} title="新建创作项目">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <FormField label="项目名称" required>
            <Input
              autoFocus
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="为这个故事起个名字"
            />
          </FormField>
          {error && <Alert variant="danger" title="创建失败">{error}</Alert>}
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!title.trim()}
          >
            创建项目
          </Button>
        </form>
      </Dialog>
    </PageContainer>
  );
}
