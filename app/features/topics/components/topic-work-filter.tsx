'use client';
export function TopicWorkFilter({ options, value, onChange }: { options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return <details className="relative text-sm">
    <summary className="cursor-pointer rounded-md border border-border-default bg-surface px-3 py-2">{value.length ? `作品（${value.length}）` : '全部作品'}</summary>
    <div className="absolute left-0 z-30 mt-1 max-h-60 min-w-48 overflow-y-auto rounded-md border border-border-default bg-surface p-3 shadow-lg">
      <button type="button" className="mb-2 text-accent" onClick={() => onChange([])}>清除作品筛选</button>
      {options.map(work => <label key={work} className="flex items-center gap-2 py-1"><input type="checkbox" checked={value.includes(work)} onChange={event => onChange(event.target.checked ? [...value, work] : value.filter(item => item !== work))} />{work}</label>)}
      {!options.length && <p className="text-muted">暂无作品</p>}
    </div>
  </details>;
}
