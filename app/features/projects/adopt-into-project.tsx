"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddProjectLink } from "@sthstart/contracts";
import { Dialog } from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { getJson } from "@/app/lib/api-client";
import { Select } from "@/app/components/ui/select";
import { projectsApi } from "./api";
import { projectKeys } from '@/app/lib/query-keys';

export function AdoptIntoProject({
  source,
  disabled = false,
}: {
  source: AddProjectLink;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ projectId: string; worldId?: string | null } | null>(null);
  const client = useQueryClient();
  const projects = useQuery({
    queryKey: projectKeys.all,
    queryFn: projectsApi.list,
    enabled: open,
    staleTime: 0,
  });
  const add = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await projectsApi.add(selected, source);
      let worldId: string | null = null;
      try {
        const res = await getJson<{ binding: { worldId: string } | null }>(
          `story-worlds/project-bindings/${encodeURIComponent(selected)}`,
        );
        worldId = res.binding?.worldId ?? null;
      } catch {
        worldId = null;
      }
      setDone({ projectId: selected, worldId });
      await client.invalidateQueries({ queryKey: projectKeys.all });
    } catch (e) {
      setError(e instanceof Error ? e.message : "收录失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setDone(null);
          setError("");
        }}
      >
        收入作品手稿
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="收入作品手稿"
        description="保存来源引用，可在关联作品工作台中进一步整理为正式设定或参考摘录。"
      >
        <div className="space-y-4">
          {projects.isLoading && <p role="status">正在读取手稿目标…</p>}
          {projects.isError && (
            <p role="alert">
              目标列表读取失败。
              <Button onClick={() => void projects.refetch()}>重试</Button>
            </p>
          )}
          {projects.data && !projects.data.items.length && (
            <p>
              还没有可用的作品手稿。
              <Link className="underline" href="/apps/story-worlds">
                前往作品目录
              </Link>
            </p>
          )}
          {!!projects.data?.items.length && (
            <label className="block space-y-2">
              <span>目标手稿</span>
              <Select
                aria-label="目标手稿"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setDone(null);
                }}
                className="w-full"
              >
                <option value="">选择作品或手稿项目</option>
                {projects.data.items.map(({ project }) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {error && (
            <p role="alert" className="text-danger-fg">
              {error}
            </p>
          )}
          {done ? (
            <p role="status" className="flex items-center gap-2">
              <span>已收入手稿。</span>
              <Link
                className="font-medium text-accent underline"
                href={
                  done.worldId
                    ? `/apps/story-worlds?world=${encodeURIComponent(done.worldId)}&view=chapters`
                    : `/apps/projects/${encodeURIComponent(done.projectId)}`
                }
              >
                {done.worldId ? '打开作品工作台' : '查看手稿'}
              </Link>
            </p>
          ) : (
            <Button
              variant="primary"
              disabled={!selected}
              loading={busy}
              onClick={() => void add()}
            >
              确认收录
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
