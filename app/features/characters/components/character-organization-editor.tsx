'use client';
import { useId } from 'react';
import type { CharacterWork } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
export type OrganizationFields = { work: string; originType: '' | 'ip' | 'original'; tags: string; groups: string; interpretation: string; fillEmpty: boolean };
export const emptyOrganizationFields: OrganizationFields = { work: '', originType: '', tags: '', groups: '', interpretation: '', fillEmpty: true };
export const splitLabels = (value: string) => [...new Set(value.split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean))];
export function CharacterOrganizationFields({ value, onChange, works = [] }: { value: OrganizationFields; onChange: (value: OrganizationFields) => void; works?: CharacterWork[] }) {
  const listId = useId();
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm">所属作品<Input list={listId} placeholder="选择或输入作品" value={value.work} onChange={e => onChange({ ...value, work: e.target.value })} /><datalist id={listId}>{works.map(w => <option key={w.name} value={w.name} />)}</datalist></label>
    <label className="text-sm">追加标签<Input placeholder="如：地域：枫丹，性格：活泼" value={value.tags} onChange={e => onChange({ ...value, tags: e.target.value })} /></label>
    <label className="text-sm">加入分组<Input placeholder="多个分组用逗号分隔" value={value.groups} onChange={e => onChange({ ...value, groups: e.target.value })} /></label>
    <label className="text-sm">人设演绎<Input placeholder="如：原作向、现代 AU" value={value.interpretation} onChange={e => onChange({ ...value, interpretation: e.target.value })} /></label>
    <label className="text-sm">创作类型<select className="block w-full rounded border p-2" value={value.originType} onChange={e => onChange({ ...value, originType: e.target.value as OrganizationFields['originType'] })}><option value="">保持各角色原值</option><option value="ip">已有 IP</option><option value="original">原创</option></select></label>
    <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={value.fillEmpty} onChange={e => onChange({ ...value, fillEmpty: e.target.checked })} />作品与演绎仅补充空白；标签和分组始终追加</label>
  </div>;
}
