"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddProjectLink } from "@sthstart/contracts";
import { Dialog } from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
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
  const [done, setDone] = useState("");
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
      setDone(selected);
      await client.invalidateQueries({ queryKey: projectKeys.all });
    } catch (e) {
      setError(e instanceof Error ? e.message : "加入失败");
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
          setDone("");
          setError("");
        }}
      >
        加入项目
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="加入创作项目"
        description="保存来源引用；在项目中可以进一步采用为设定。"
      >
        <div className="space-y-4">
          {projects.isLoading && <p role="status">正在读取项目…</p>}
          {projects.isError && (
            <p role="alert">
              项目读取失败。
              <Button onClick={() => void projects.refetch()}>重试</Button>
            </p>
          )}
          {projects.data && !projects.data.items.length && (
            <p>
              还没有创作项目。
              <Link className="underline" href="/apps/projects">
                先新建项目
              </Link>
            </p>
          )}
          {!!projects.data?.items.length && (
            <label className="block space-y-2">
              <span>目标项目</span>
              <Select
                aria-label="目标项目"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setDone("");
                }}
                className="w-full"
              >
                <option value="">选择项目</option>
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
            <p role="status">
              已加入。
              <Link className="underline" href={"/apps/projects/" + done}>
                打开项目
              </Link>
            </p>
          ) : (
            <Button
              variant="primary"
              disabled={!selected}
              loading={busy}
              onClick={() => void add()}
            >
              确认加入
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
