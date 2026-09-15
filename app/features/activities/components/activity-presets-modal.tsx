'use client';
import { CreationProfileEditor } from './creation-profile-picker';

import React, { useState } from 'react';
import {
  Bookmark,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Layers,
  Sparkles,
  PlaySquare,
  AlertCircle,
} from 'lucide-react';
import type { Activity, ContentDocument, ActivityReusablePreset, ActivityPresetKind } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';
import {
  useActivityPresets,
  useImageConfigDraft,
} from '../queries';
import {
  useCreateActivityPreset,
  useUpdateActivityPreset,
  useDeleteActivityPreset,
} from '../mutations';

interface ActivityPresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity;
  document: ContentDocument;
}

export function ActivityPresetsModal({
  isOpen,
  onClose,
  activity,
  document,
}: ActivityPresetsModalProps) {
  const [activeTab, setActiveTab] = useState<'save_template' | 'manage'>('save_template');
  const [templateName, setTemplateName] = useState(`${document.activity.title || '自定义活动'} 模板`);
  const [roleOptions,setRoleOptions]=useState(()=>document.actors.map((a,i)=>({id:i===0?'lead':i===1?'guest':`role_${i+1}`,label:a.activityRole||`职责 ${i+1}`,required:true,multiple:false})));
  const [replaceNames,setReplaceNames]=useState(true);
  const [manageKindFilter, setManageKindFilter] = useState<string>('all');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  const { data: imageConfig }=useImageConfigDraft(isOpen?activity.id:undefined);
  const { data: presetsData, isLoading: presetsLoading } = useActivityPresets();
  const createPresetMutation = useCreateActivityPreset();
  const updatePresetMutation = useUpdateActivityPreset();
  const deletePresetMutation = useDeleteActivityPreset();

  const presets = presetsData?.items || [];
  const filteredPresets = manageKindFilter === 'all'
    ? presets
    : presets.filter((p) => p.kind === manageKindFilter);

  // Build payload for saving template
  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) {
      setStatusMessage({ type: 'danger', text: '请输入模板名称' });
      return;
    }

    try {
      // Map actors to role slots
      const roleSlotIds=roleOptions.map(r=>r.id);
      const templateText=(text:string)=>replaceNames?document.actors.reduce((value,actor,index)=>actor.displayName?value.split(actor.displayName).join(`{{role.${roleSlotIds[index]}}}`):value,text):text;

      const stagesPayload = (document.stages || []).map((s) => ({
        title: templateText(s.title),
        instruction: templateText(s.instruction),
        location: templateText(s.location),
        requiredBeats: (s.requiredBeats || []).map((b) => templateText(b.text)),
        roleSlotIds: s.actorIds.map(id => roleSlotIds[document.actors.findIndex(a => a.id === id)]).filter(Boolean),
        endCondition: templateText(s.endCondition),
      }));

      await createPresetMutation.mutateAsync({
        kind: 'activity_template',
        name: templateName.trim(),
        payload: {
          schemaVersion: 2,
          activityType: document.activity.type || '自定义活动',
          theme: document.activity.theme || '',
          location: document.activity.location || '',
          rules: templateText(document.activity.rules || ''),
          roleSlots: roleOptions,
          stages: stagesPayload,
        },
      });

      setStatusMessage({ type: 'success', text: `模板「${templateName.trim()}」已成功保存！` });
      setActiveTab('manage');
    } catch (err) {
      setStatusMessage({
        type: 'danger',
        text: err instanceof Error ? err.message : '保存模板失败',
      });
    }
  };

  const handleStartRename = (preset: ActivityReusablePreset) => {
    setEditingPresetId(preset.id);
    setEditingName(preset.name);
  };

  const handleSaveRename = async (presetId: string) => {
    if (!editingName.trim()) return;
    try {
      await updatePresetMutation.mutateAsync({
        id: presetId,
        input: { name: editingName.trim() },
      });
      setEditingPresetId(null);
    } catch (err) {
      setStatusMessage({
        type: 'danger',
        text: err instanceof Error ? err.message : '修改名称失败',
      });
    }
  };

  const handleDelete = async (presetId: string, name: string) => {
    if (!window.confirm(`确定要删除预设「${name}」吗？`)) return;
    try {
      await deletePresetMutation.mutateAsync(presetId);
      setStatusMessage({ type: 'success', text: `预设「${name}」已删除` });
    } catch (err) {
      setStatusMessage({
        type: 'danger',
        text: err instanceof Error ? err.message : '删除预设失败',
      });
    }
  };

  const getKindBadge = (kind: ActivityPresetKind) => {
    switch (kind) {
      case 'activity_template':
        return <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200"><Layers className="h-3 w-3 mr-1 inline" />活动模板</Badge>;
      case 'production_preset':
        return <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200"><Sparkles className="h-3 w-3 mr-1 inline" />生产预设</Badge>;
      case 'playback_preset':
        return <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200"><PlaySquare className="h-3 w-3 mr-1 inline" />回放预设</Badge>;
      case 'creation_profile': return <Badge variant="outline">创作配置</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{kind}</Badge>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(val) => { if (!val) onClose(); }} title="活动模板与预设管理">
      <div className="space-y-4 py-1">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-border-default pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setActiveTab('save_template'); setStatusMessage(null); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'save_template'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              另存当前活动为模板
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('manage'); setStatusMessage(null); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'manage'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              我的预设库 ({presets.length})
            </button>
          </div>
        </div>

        {statusMessage && (
          <Alert variant={statusMessage.type} title="提示">
            {statusMessage.text}
          </Alert>
        )}

        <CreationProfileEditor key={imageConfig?.baseRevisionId||imageConfig?.draftVersion||'loading'} initial={{values:{...(document.activity.creationProfile?.values as Record<string,unknown>||{}),...(imageConfig?{globalStylePrompt:imageConfig.document.globalStylePrompt,globalNegativePrompt:imageConfig.document.globalNegativePrompt}:{})}}}/>
        {/* TAB 1: SAVE AS TEMPLATE */}
        {activeTab === 'save_template' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">模板名称</label>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="例如：海滩度假派对模板"
                className="text-sm"
              />
            </div>

            <fieldset className="space-y-2 rounded-lg border border-border-default p-3"><legend className="text-sm font-semibold">模板职责</legend>
              {roleOptions.map((role,index)=><div key={role.id} className="flex flex-wrap gap-2 items-center text-xs"><span>{document.actors[index]?.displayName} →</span><Input aria-label={`职责 ${index+1} 名称`} className="w-32" value={role.label} onChange={e=>setRoleOptions(roles=>roles.map((r,i)=>i===index?{...r,label:e.target.value}:r))}/><label><input type="checkbox" checked={role.required} onChange={e=>setRoleOptions(roles=>roles.map((r,i)=>i===index?{...r,required:e.target.checked}:r))}/> 必选</label><label><input type="checkbox" checked={role.multiple} onChange={e=>setRoleOptions(roles=>roles.map((r,i)=>i===index?{...r,multiple:e.target.checked}:r))}/> 可多人</label><code>{`{{role.${role.id}}}`}</code></div>)}
              <label className="block text-sm"><input type="checkbox" checked={replaceNames} onChange={e=>setReplaceNames(e.target.checked)}/> 将阶段和规则中出现的角色名转换为职责占位符</label>
              <p className="text-xs text-muted">只转换与当前显示名完全相同的文字，不猜测称谓。下次套用时，名称会随职责映射替换。</p>
              <div className="max-h-32 overflow-auto text-xs whitespace-pre-wrap">{document.stages.map(stage=>{const text=`${stage.title}：${stage.instruction}`;return <p key={stage.id}>{replaceNames?document.actors.reduce((v,a,i)=>a.displayName?v.split(a.displayName).join(`{{role.${roleOptions[i].id}}}`):v,text):text}</p>;})}</div>
            </fieldset>
            {/* Template preview */}
            <div className="rounded-lg border border-border-default bg-surface-raised p-3.5 space-y-3">
              <span className="text-xs font-semibold text-ink">将持久化保留的结构</span>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                <div>活动类型: <span className="text-ink font-medium">{document.activity.type || '自定义活动'}</span></div>
                <div>默认地点: <span className="text-ink font-medium">{document.activity.location || '未指定'}</span></div>
                <div>阶段数量: <span className="text-ink font-medium">{document.stages?.length || 0} 个阶段</span></div>
                <div>角色槽位: <span className="text-ink font-medium">{document.actors?.length || 0} 个角色职责</span></div>
              </div>

              <div className="border-t border-border-subtle pt-2 space-y-2">
                <span className="text-xs text-muted block">包含的阶段规划：</span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(document.stages || []).map((s, idx) => (
                    <div key={s.id} className="text-xs p-2 rounded bg-surface border border-border-subtle flex items-start justify-between">
                      <div>
                        <span className="font-semibold text-ink">阶段 {idx + 1} · {s.title}</span>
                        {s.instruction && <p className="text-muted line-clamp-1 mt-0.5">{s.instruction}</p>}
                      </div>
                      <span className="text-xs text-muted shrink-0 font-mono">
                        {s.requiredBeats?.length || 0} 个节拍
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted pt-1">
                注意：保存为模板时，<strong>不会携带</strong>本场的具体聊天记录、朋友圈正文、旧生图任务与媒体绑定。在用模板创建新活动时，阶段 ID 与节拍 ID 将重新生成。
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleSaveAsTemplate}
                disabled={createPresetMutation.isPending}
                className="flex items-center gap-1.5"
              >
                {createPresetMutation.isPending && <Spinner className="h-3 w-3 animate-spin" />}
                <Bookmark className="h-3.5 w-3.5" />
                <span>确认另存为模板</span>
              </Button>
            </div>
          </div>
        )}

        {/* TAB 2: MANAGE PRESETS */}
        {activeTab === 'manage' && (
          <div className="space-y-4">
            {/* Filter */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted">类型筛选:</span>
                {[
                  { id: 'all', label: '全部' },
                  { id: 'activity_template', label: '活动模板' },
                  { id: 'production_preset', label: '生产预设' },
                  { id: 'playback_preset', label: '回放预设' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setManageKindFilter(f.id)}
                    className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                      manageKindFilter === f.id
                        ? 'border-accent bg-accent/10 text-accent font-semibold'
                        : 'border-border-default bg-surface hover:bg-surface-hover text-ink'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {presetsLoading ? (
              <div className="py-8 flex justify-center">
                <Spinner className="h-6 w-6 text-accent animate-spin" />
              </div>
            ) : filteredPresets.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">
                暂无保存的预设。您可以在活动中将当前结构另存为模板，或在生图/回放工作区中保存预设。
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {filteredPresets.map((preset) => {
                  const isEditing = editingPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className="p-3 rounded-lg border border-border-default bg-surface hover:border-border-strong transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {getKindBadge(preset.kind)}
                          {isEditing ? (
                            <div className="flex items-center gap-1.5 flex-1">
                              <Input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="h-7 text-xs py-0 px-2"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => handleSaveRename(preset.id)}
                              >
                                <Check className="h-3 w-3 text-success-fg" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={() => setEditingPresetId(null)}
                              >
                                <X className="h-3 w-3 text-muted" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-semibold text-xs text-ink truncate">
                              {preset.name}
                            </span>
                          )}
                          <span className="text-2xs text-muted font-mono">v{preset.version}</span>
                        </div>
                        <div className="text-2xs text-muted">
                          更新于 {new Date(preset.updatedAt).toLocaleString()}
                        </div>
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleStartRename(preset)}
                            className="p-1 rounded text-muted hover:text-ink hover:bg-surface-hover"
                            title="重命名"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(preset.id, preset.name)}
                            className="p-1 rounded text-muted hover:text-danger-fg hover:bg-surface-hover"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                关闭
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
