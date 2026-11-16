'use client';
import { useId } from 'react';
import type { CharacterOriginType, CharacterWork } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Checkbox } from '@/app/components/ui/checkbox';
import { FormField } from '@/app/components/ui/form-field';
export type OrganizationFields = { work: string; originType: '' | CharacterOriginType; tags: string; groups: string; interpretation: string; fillEmpty: boolean };
export const emptyOrganizationFields: OrganizationFields = { work: '', originType: '', tags: '', groups: '', interpretation: '', fillEmpty: true };
export const splitLabels = (value: string) => [...new Set(value.split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean))];
export function CharacterOrganizationFields({ value, onChange, works = [] }: { value: OrganizationFields; onChange: (value: OrganizationFields) => void; works?: CharacterWork[] }) {
  const listId = useId();
  return <>
  <div className="grid gap-3 sm:grid-cols-2">
    <FormField label="所属作品"><Input list={listId} placeholder="选择或输入作品" value={value.work} onChange={e => onChange({ ...value, work: e.target.value })} /></FormField>
    <FormField label="追加标签"><Input placeholder="如：地域：枫丹，性格：活泼" value={value.tags} onChange={e => onChange({ ...value, tags: e.target.value })} /></FormField>
    <FormField label="加入分组"><Input placeholder="多个分组用逗号分隔" value={value.groups} onChange={e => onChange({ ...value, groups: e.target.value })} /></FormField>
    <FormField label="人设演绎"><Input placeholder="如：原作向、现代 AU" value={value.interpretation} onChange={e => onChange({ ...value, interpretation: e.target.value })} /></FormField>
    <FormField label="创作类型"><Select value={value.originType} onChange={e => onChange({ ...value, originType: e.target.value as OrganizationFields['originType'] })}><option value="">保持各角色原值</option><option value="ip">原作 IP</option><option value="derivative">同人衍生</option><option value="original">原创</option></Select></FormField>
    <div className="sm:col-span-2">
      <Checkbox label="作品与演绎仅补充空白；标签和分组始终追加" checked={value.fillEmpty} onChange={e => onChange({ ...value, fillEmpty: e.target.checked })} />
    </div>
  </div>
  <datalist id={listId}>{works.map(w => <option key={w.name} value={w.name} />)}</datalist>
  </>;
}
