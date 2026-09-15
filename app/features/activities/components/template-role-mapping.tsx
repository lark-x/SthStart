'use client';
import { templateRoles } from '@sthstart/contracts';
export function TemplateRoleMapping({ payload, actors, value, onChange }: {
    payload: Record<string, unknown>;
    actors: Array<{
        id: string;
        displayName: string;
    }>;
    value: Record<string, string[]>;
    onChange: (value: Record<string, string[]>) => void;
}) {
    const roles = templateRoles(payload);
    if (!roles.length)
        return null;
    const render = (text: unknown) => String(text || '').replace(/\{\{role\.([\w-]+)\}\}/g, (_, id: string) => (value[id] || []).map(id => actors.find(a => a.id === id)?.displayName || '已移除角色').join('、') || '待选择角色');
    return <fieldset className="space-y-3 rounded-lg border border-border-default p-3"><legend className="px-1 text-sm font-semibold">本次活动的角色职责</legend>
    <p className="text-xs text-muted">下面是自动建议，可以调整。同一人可以承担多个职责；更换参与者后请检查映射。</p>
    {roles.map(role => <div key={role.id} className="space-y-1"><label className="text-sm">{role.label}{role.required ? '（必选）' : ''}{role.multiple ? ' · 可多人' : ''}</label>
      <div className="flex flex-wrap gap-2">{actors.map(actor => <label key={actor.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={(value[role.id] || []).includes(actor.id)} onChange={e => onChange({ ...value, [role.id]: e.target.checked ? (role.multiple ? [...(value[role.id] || []), actor.id] : [actor.id]) : (value[role.id] || []).filter(id => id !== actor.id) })}/>{actor.displayName}</label>)}</div>
      {(value[role.id] || []).some(id => !actors.some(a => a.id === id)) && <p className="text-xs text-red-600">已映射角色被移除，请重新选择。</p>}
      {role.required && !(value[role.id] || []).length && <p className="text-xs text-amber-700">尚未选择此职责。</p>}
    </div>)}
    <details open className="border-t border-border-default pt-2"><summary className="text-sm cursor-pointer">本次套用预览</summary><div className="mt-2 space-y-2 text-xs text-muted">{((payload.stages || []) as Array<{
        title?: string;
        instruction?: string;
    }>).map((stage, index) => <p key={index}><strong>{index + 1}. {render(stage.title)}</strong><br />{render(stage.instruction)}</p>)}</div></details>
  </fieldset>;
}
