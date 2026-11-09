"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowRight, FolderOpen } from "lucide-react";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Dialog } from "@/app/components/ui/dialog";
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
  return <div className="flex w-full max-w-sm items-center gap-2">
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
    <PageContainer className="project-library space-y-6 pb-10 pt-4 sm:pt-6">
      <PageHeader
        title="创作项目"
        description="围绕一部作品组织正文、角色、参考资料与制作版本。"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus size={16} />新建项目
          </Button>
        }
      />
      <div className="project-library-tools flex flex-wrap items-center justify-between gap-4">
        <ProjectSearch value={state.q} onSearch={q => update({ q })} />
        <Select aria-label="项目排序" value={state.sort} onChange={event => update({ sort: event.target.value as ProjectListState['sort'] })}>
          <option value="updated">最近更新</option><option value="created">最近创建</option><option value="title">名称顺序</option>
        </Select>
        <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新列表</Button>
        <Link
          href="/apps/activities"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          查看全部制作 <ArrowRight size={16} />
        </Link>
      </div>
      <div aria-busy={query.isFetching}>
      {query.isLoading && <p role="status">正在读取项目…</p>}
      {query.isPlaceholderData && <p role="status" className="pb-4 text-sm text-muted">正在更新，以下为上次查询结果…</p>}
      {query.isError && (
        <p role="alert">
          项目加载失败。
          <Button onClick={() => void query.refetch()}>重试</Button>
        </p>
      )}
      {query.data && !query.isError && !query.isPlaceholderData && !items.length && (
        <div className="space-y-3 border-y border-border-subtle py-16 text-center">
          <FolderOpen className="mx-auto text-muted" />
          <h2 className="font-semibold">
            {state.q ? "没有匹配的项目" : "从一个故事开始"}
          </h2>
          <p className="text-sm text-muted">
            {state.q
              ? "换一个关键词试试。"
              : "创建项目后，已有角色和资料都可以加入。"}
          </p>
        </div>
      )}
      <div className="project-library-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(
          ({ project, chapters, characters, references, productions }) => (
            <Link
              key={project.id}
              href={"/apps/projects/" + project.id + '?returnTo=' + encodeURIComponent(scrollHref)}
              onClick={rememberPosition}
              className="project-library-card group flex min-h-48 flex-col rounded-xl border border-border-subtle bg-surface p-6 transition-colors hover:border-border-default focus-visible:outline-2 focus-visible:outline-accent"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-semibold text-ink">
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
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 pt-6 text-xs text-muted">
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
      <Dialog open={open} onOpenChange={setOpen} title="新建创作项目">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="block space-y-2">
            <span>项目名称</span>
            <Input
              autoFocus
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="为这个故事起个名字"
            />
          </label>
          {error && <p role="alert">{error}</p>}
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
