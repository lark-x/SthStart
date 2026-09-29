'use client';

import React, { useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import {
  Clock,
  MapPin,
  Sparkles,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  Film,
  CheckCircle2,
  SlidersHorizontal,
  Camera,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
} from 'lucide-react';
import type {
  StageDefinition,
  ContentDocument,
  ActorSnapshot,
  ActivityScene,
  SceneBeat,
} from '@sthstart/contracts';
import { useCharacters } from '@/app/features/characters/queries';
import { useToast } from '@/app/providers/ui-provider';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { ScenePreviewDrawer } from './scene-preview-drawer';
import { getEffectiveStageScenes, writeStageScenes } from '../scene-beat-utils';
import { BeatRenderWorkbench } from './beat-render-workbench';

interface SceneBeatEditorProps {
  activityId?: string;
  stage: StageDefinition;
  document: ContentDocument;
  actors: ActorSnapshot[];
  onUpdateDocument: (doc: ContentDocument) => void;
  onBeforeMediaGeneration?: () => Promise<boolean>;
  onAdoptMediaResult?: (document: ContentDocument, draftVersion: number) => void;
  onAutoAppliedCheck?: () => void;
  disabled?: boolean;
}

export function SceneBeatEditor({
  activityId,
  stage,
  document,
  actors,
  onUpdateDocument,
  onBeforeMediaGeneration,
  onAdoptMediaResult,
  onAutoAppliedCheck,
  disabled = false,
}: SceneBeatEditorProps) {
  // Preview Drawer state
  const [previewScene, setPreviewScene] = useState<ActivityScene | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const documentRef = useRef(document);
  documentRef.current = document;

  const toast = useToast();
  // Scheme B: Master-Detail selection & Inspector collapse state
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [editBeatOpen, setEditBeatOpen] = useState(false);
  const [editSceneOpen, setEditSceneOpen] = useState(false);
  const [discardSceneOpen, setDiscardSceneOpen] = useState(false);
  const [sceneDraft, setSceneDraft] = useState<{
    title: string;
    timeText: string;
    locationText: string;
    environment: string;
  } | null>(null);

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const syncLayout = () => {
      setIsNarrowViewport(media.matches);
      setIsInspectorCollapsed(media.matches);
    };
    syncLayout();
    media.addEventListener('change', syncLayout);
    return () => media.removeEventListener('change', syncLayout);
  }, []);

  const replaceStageScenes = (nextScenes: ActivityScene[]) => {
    const nextDocument = writeStageScenes(documentRef.current, stage.id, nextScenes);
    documentRef.current = nextDocument;
    onUpdateDocument(nextDocument);
  };

  // 角色库查询（用于头像穿透直连与官方立绘映射）
  const { data: charactersData } = useCharacters();
  const characters = charactersData?.items || [];

  const characterMap = useMemo(() => {
    const map = new Map<string, typeof characters[0]>();
    for (const c of characters) {
      map.set(c.id, c);
      if (c.displayName) {
        map.set(c.displayName, c);
      }
    }
    return map;
  }, [characters]);

  // 头像穿透获取函数：优先直连角色库官方立绘
  const getCharacterAvatar = (characterId?: string, actor?: ActorSnapshot) => {
    if (!characterId || characterId === 'narrator') return null;
    const byId = characterMap.get(characterId);
    if (byId?.avatarUrl) return byId.avatarUrl;
    if (actor?.sourceCharacterId) {
      const bySource = characterMap.get(actor.sourceCharacterId);
      if (bySource?.avatarUrl) return bySource.avatarUrl;
    }
    if (actor?.displayName) {
      const byName = characterMap.get(actor.displayName);
      if (byName?.avatarUrl) return byName.avatarUrl;
    }
    return actor?.avatarUrl || null;
  };

  // Map actors
  const actorMap = useMemo(() => new Map(actors.map((a) => [a.id, a])), [actors]);

  // Current stage scenes
  const scenes = useMemo(() => {
    return getEffectiveStageScenes(stage, document.scenes);
  }, [stage, document.scenes]);

  // Check if there are legacy messages for this stage that can be migrated
  const legacyMessages = useMemo(() => {
    return (document.messages || []).filter((m) => m.stageId === stage.id);
  }, [document.messages, stage.id]);

  // Active scene
  const currentScene = useMemo(() => {
    if (scenes.length === 0) return null;
    if (activeSceneId) {
      const found = scenes.find((s) => s.id === activeSceneId);
      if (found) return found;
    }
    return scenes[0];
  }, [scenes, activeSceneId]);

  const currentSceneIndex = useMemo(() => {
    if (!currentScene) return 0;
    return Math.max(0, scenes.findIndex((s) => s.id === currentScene.id));
  }, [scenes, currentScene]);

  // Selected beat within active scene
  const currentBeat = useMemo(() => {
    if (!currentScene || currentScene.beats.length === 0) return null;
    if (selectedBeatId) {
      const found = currentScene.beats.find((b) => b.id === selectedBeatId);
      if (found) return found;
    }
    return currentScene.beats[0] || null;
  }, [currentScene, selectedBeatId]);

  const currentBeatIndex = useMemo(() => {
    if (!currentScene || !currentBeat) return 0;
    return Math.max(0, currentScene.beats.findIndex((b) => b.id === currentBeat.id));
  }, [currentScene, currentBeat]);

  React.useEffect(() => {
    if (!activeSceneId || !scenes.some((item) => item.id === activeSceneId)) {
      setActiveSceneId(scenes[0]?.id || null);
    }
  }, [activeSceneId, scenes]);

  React.useEffect(() => {
    if (!currentScene || !selectedBeatId || !currentScene.beats.some((item) => item.id === selectedBeatId)) {
      setSelectedBeatId(currentScene?.beats[0]?.id || null);
    }
  }, [currentScene, selectedBeatId]);

  // Helper to remove mechanical prefix like "第 1 场：" or "第1场："
  const cleanSceneTitle = (title: string) => {
    return title.replace(/^(第\s*[一二三四五六七八九十0-9]+\s*场[：:\s]*)/, '') || title;
  };

  const openSceneEditor = () => {
    if (!currentScene) return;
    setSceneDraft({
      title: cleanSceneTitle(currentScene.title),
      timeText: currentScene.timeText || '',
      locationText: currentScene.locationText || '',
      environment: currentScene.environment || '',
    });
    setEditSceneOpen(true);
  };

  const sceneDraftChanged = Boolean(currentScene && sceneDraft && (
    sceneDraft.title !== cleanSceneTitle(currentScene.title)
    || sceneDraft.timeText !== (currentScene.timeText || '')
    || sceneDraft.locationText !== (currentScene.locationText || '')
    || sceneDraft.environment !== (currentScene.environment || '')
  ));

  const requestCloseSceneEditor = (open: boolean) => {
    if (open) {
      setEditSceneOpen(true);
      return;
    }
    if (sceneDraftChanged) {
      setDiscardSceneOpen(true);
      return;
    }
    setEditSceneOpen(false);
    setSceneDraft(null);
  };

  const discardSceneDraft = () => {
    setDiscardSceneOpen(false);
    setEditSceneOpen(false);
    setSceneDraft(null);
  };

  const applySceneDraft = () => {
    if (!currentScene || !sceneDraft || disabled) return;
    handleUpdateScene({
      ...currentScene,
      title: sceneDraft.title.trim() || '未命名场次',
      timeText: sceneDraft.timeText.trim(),
      locationText: sceneDraft.locationText.trim(),
      environment: sceneDraft.environment.trim(),
    });
    setEditSceneOpen(false);
    setSceneDraft(null);
  };

  // Convert legacy messages to a default scene with beats
  const handleConvertLegacyMessages = () => {
    const newSceneId = `scene_${Date.now()}`;
    const convertedBeats: SceneBeat[] = legacyMessages.map((msg, idx) => {
      const speaker = msg.speakerActorId ? actorMap.get(msg.speakerActorId) : undefined;
      return {
        id: `beat_${Date.now()}_${idx}`,
        sceneId: newSceneId,
        stageId: stage.id,
        characterId: msg.speakerActorId || 'narrator',
        characterName: speaker?.displayName || '旁白',
        action: '',
        dialogue: msg.text,
        outcome: '',
        orderIndex: idx * 10,
      };
    });

    const newScene: ActivityScene = {
      id: newSceneId,
      stageId: stage.id,
      title: stage.title.replace(/^(阶段[一二三四五六七八九十0-9]+[：:\s]*|第[一二三四五六七八九十0-9]+幕[：:\s]*)/, '') || '新场次',
      timeText: '',
      locationText: stage.location || '',
      environment: '',
      beats: convertedBeats,
      orderIndex: 0,
    };

    replaceStageScenes([newScene]);
    setActiveSceneId(newSceneId);
    setSelectedBeatId(convertedBeats[0]?.id || null);
  };

  // Add a new empty scene
  const handleAddScene = () => {
    const newSceneId = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newScene: ActivityScene = {
      id: newSceneId,
      stageId: stage.id,
      title: `新场次 ${scenes.length + 1}`,
      timeText: '',
      locationText: stage.location || '',
      environment: '',
      beats: [
        {
          id: `beat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sceneId: newSceneId,
          stageId: stage.id,
          characterId: actors[0]?.id || 'narrator',
          characterName: actors[0]?.displayName || '旁白',
          action: '',
          dialogue: '',
          outcome: '',
          orderIndex: 0,
        },
      ],
      orderIndex: scenes.length * 10,
    };

    replaceStageScenes([...scenes, newScene]);
    setActiveSceneId(newSceneId);
    setSelectedBeatId(newScene.beats[0]?.id || null);
  };

  // Update a scene
  const handleUpdateScene = (updatedScene: ActivityScene) => {
    const latestStage = documentRef.current.stages.find((item) => item.id === stage.id);
    if (!latestStage) return;
    const latestScenes = getEffectiveStageScenes(latestStage, documentRef.current.scenes);
    if (!latestScenes.some((item) => item.id === updatedScene.id)) return;
    replaceStageScenes(latestScenes.map((item) => item.id === updatedScene.id ? updatedScene : item));
  };

  // Delete a scene
  const handleDeleteScene = (sceneId: string) => {
    if (!confirm('确定删除该场次及场次内的所有分镜卡片吗？')) return;

    const latestStage = documentRef.current.stages.find((item) => item.id === stage.id);
    if (!latestStage) return;
    const remaining = getEffectiveStageScenes(latestStage, documentRef.current.scenes).filter((item) => item.id !== sceneId);
    replaceStageScenes(remaining);
    if (remaining.length > 0) {
      setActiveSceneId(remaining[0].id);
      setSelectedBeatId(remaining[0].beats[0]?.id || null);
    }
  };

  // Add beat to scene
  const handleAddBeat = (scene: ActivityScene, insertIndex?: number) => {
    const newBeatId = `beat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newBeat: SceneBeat = {
      id: newBeatId,
      sceneId: scene.id,
      stageId: stage.id,
      characterId: actors[0]?.id || 'narrator',
      characterName: actors[0]?.displayName || '旁白',
      action: '',
      dialogue: '',
      outcome: '',
      orderIndex: (scene.beats.length + 1) * 10,
    };

    const nextBeats = [...scene.beats];
    if (insertIndex !== undefined && insertIndex >= 0) {
      nextBeats.splice(insertIndex, 0, newBeat);
    } else {
      nextBeats.push(newBeat);
    }

    handleUpdateScene({
      ...scene,
      beats: nextBeats,
    });
    setSelectedBeatId(newBeatId);
    setIsInspectorCollapsed(false);
  };

  // Update beat
  const handleUpdateBeat = (scene: ActivityScene, beatId: string, patch: Partial<SceneBeat>) => {
    const nextBeats = scene.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b));
    handleUpdateScene({
      ...scene,
      beats: nextBeats,
    });
  };

  // Delete beat
  const handleDeleteBeat = (scene: ActivityScene, beatId: string) => {
    const nextBeats = scene.beats.filter((b) => b.id !== beatId);
    handleUpdateScene({
      ...scene,
      beats: nextBeats,
    });
    if (selectedBeatId === beatId) {
      setSelectedBeatId(nextBeats[0]?.id || null);
    }
  };

  // Move beat
  const handleMoveBeat = (scene: ActivityScene, index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= scene.beats.length) return;

    const nextBeats = [...scene.beats];
    const temp = nextBeats[index];
    nextBeats[index] = nextBeats[targetIndex];
    nextBeats[targetIndex] = temp;

    handleUpdateScene({
      ...scene,
      beats: nextBeats,
    });
  };

  // If no scenes exist
  if (scenes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="rounded-2xl border border-border-default bg-surface p-8 max-w-lg text-center space-y-4 shadow-sm">
          <Film className="h-12 w-12 mx-auto text-accent opacity-70" />
          <div className="space-y-1.5">
            <h3 className="text-base font-bold text-ink">本阶段还没有场次</h3>
            <p className="text-xs text-muted leading-relaxed">
              新建一场后，可以逐条补充分镜动作、台词和结果；这些内容都会保留在草稿中。
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {legacyMessages.length > 0 && (
              <Button
                type="button"
                variant="accent"
                onClick={handleConvertLegacyMessages}
                className="text-xs font-semibold"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                <span>从现有 {legacyMessages.length} 条对话创建分镜草稿</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleAddScene}
              className="text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              <span>新建场次（设定时间与地点）</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const beatEditorForm = currentScene && currentBeat ? (
    <div className="space-y-4">
      <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">出场角色</span>
        <select value={currentBeat.characterId} onChange={(event) => {
          const characterId = event.target.value;
          const selectedActor = actorMap.get(characterId);
          handleUpdateBeat(currentScene, currentBeat.id, { characterId, characterName: selectedActor?.displayName ?? '旁白' });
        }} disabled={disabled} className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink">
          <option value="narrator">旁白 / 场景交代</option>
          {actors.map((item) => <option key={item.id} value={item.id}>{item.displayName}{item.activityRole ? `（${item.activityRole}）` : ''}</option>)}
        </select>
      </label>
      <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">动作 / 发生事件</span>
        <Textarea rows={5} value={currentBeat.action} onChange={(event) => handleUpdateBeat(currentScene, currentBeat.id, { action: event.target.value })}
          placeholder="描述角色在此场景中的具体动作、表情或正在发生的事件" disabled={disabled} />
      </label>
      <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">台词 / 心理独白（可选）</span>
        <Input value={currentBeat.dialogue ?? ''} onChange={(event) => handleUpdateBeat(currentScene, currentBeat.id, { dialogue: event.target.value })}
          placeholder="角色说的话或内心独白" disabled={disabled} />
      </label>
      <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">剧情事实 / 达成结果（可选）</span>
        <Input value={currentBeat.outcome ?? ''} onChange={(event) => handleUpdateBeat(currentScene, currentBeat.id, { outcome: event.target.value })}
          placeholder="动作带来的线索、结论或关系变化" disabled={disabled} />
      </label>
      <div className="flex justify-end"><Button type="button" onClick={() => setEditBeatOpen(false)}>完成</Button></div>
    </div>
  ) : null;

  return (
    <div className="h-full flex flex-col min-h-0 space-y-2.5 overflow-hidden">
      {/* 1. 顶栏场次切换条 (仅在多场次时展示，单场次时隐藏以释放垂直空间) */}
      {scenes.length > 1 && (
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-0.5 shrink-0 text-xs">
          <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
            {scenes.map((s, sIdx) => {
              const isActive = s.id === currentScene?.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveSceneId(s.id);
                    setSelectedBeatId(s.beats[0]?.id || null);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-surface font-bold text-ink shadow-2xs border border-border-default'
                      : 'text-muted hover:text-ink hover:bg-surface-muted/60 border border-transparent'
                  }`}
                >
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${isActive ? 'bg-accent text-white font-bold' : 'bg-surface-muted text-muted'}`}>
                    第 {sIdx + 1} 场
                  </span>
                  <span className="truncate max-w-[130px] sm:max-w-[180px]">{cleanSceneTitle(s.title)}</span>
                  <span className="text-[10px] text-muted font-mono">({s.beats.length}镜)</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={handleAddScene}
              disabled={disabled}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-ink hover:bg-surface-muted border border-dashed border-border-default flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
              title="新建场次"
            >
              <Plus className="h-3 w-3" />
              <span>加场</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. 当前场次时空与操作栏 (Scene Header: 紧凑单行胶囊 + 操作收敛) */}
      {currentScene && (
        <div className="rounded-xl bg-surface-muted/35 px-4 py-3 space-y-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="px-2 py-0.5 rounded bg-accent text-white font-bold text-xs shrink-0 shadow-2xs font-mono">
                第 {currentSceneIndex + 1} 场
              </span>
              <div className="min-w-0 space-y-1">
                <h2 className="truncate text-sm font-semibold text-ink sm:text-base">
                  {cleanSceneTitle(currentScene.title) || '未命名场次'}
                </h2>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 shrink-0" />{currentScene.timeText || '未设置时间'}</span>
                  <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="max-w-64 truncate">{currentScene.locationText || '未设置地点'}</span></span>
                  {currentScene.environment?.trim() && <span className="inline-flex min-w-0 items-center gap-1"><Sparkles className="h-3.5 w-3.5 shrink-0" /><span className="max-w-80 truncate">{currentScene.environment}</span></span>}
                </div>
              </div>
            </div>

            {/* 场次右侧操作 */}
            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              <Button type="button" variant="outline" size="sm" onClick={openSceneEditor} disabled={disabled} className="h-8 px-2.5 text-xs">
                编辑场次
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreviewScene(currentScene);
                  setPreviewOpen(true);
                }}
                className="h-7 px-2.5 text-xs text-accent border-accent/30 hover:bg-accent/10 font-semibold cursor-pointer"
              >
                <Play className="h-3 w-3 mr-1" />
                <span>连贯试演</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAddBeat(currentScene)}
                disabled={disabled}
                className="h-7 px-2.5 text-xs font-semibold cursor-pointer"
              >
                <Plus className="h-3 w-3 mr-1" />
                <span>添加分镜</span>
              </Button>

              {scenes.length <= 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddScene}
                  disabled={disabled}
                  className="h-7 px-2 text-xs text-muted hover:text-ink cursor-pointer"
                  title="新建场次"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  <span>加场</span>
                </Button>
              )}

              {/* 检查器展开/折叠快捷开关 */}
              <button
                type="button"
                onClick={() => setIsInspectorCollapsed(!isInspectorCollapsed)}
                className="h-7 px-2 text-xs text-muted hover:text-ink flex items-center gap-1 rounded-md border border-border-default hover:bg-surface-muted/60 transition-colors cursor-pointer"
                title={isInspectorCollapsed ? '展开右侧镜头工坊' : '收起镜头工坊以全宽阅读'}
              >
                {isInspectorCollapsed ? (
                  <>
                    <PanelRightOpen className="h-3.5 w-3.5 text-accent" />
                    <span className="hidden sm:inline">展开工坊</span>
                  </>
                ) : (
                  <>
                    <PanelRightClose className="h-3.5 w-3.5 text-muted" />
                    <span className="hidden sm:inline">收起工坊</span>
                  </>
                )}
              </button>

              {scenes.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteScene(currentScene.id)}
                  disabled={disabled}
                  className="h-7 w-7 p-0 text-muted hover:text-red-600 cursor-pointer"
                  title="删除该场次"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

        </div>
      )}

      {currentScene && sceneDraft && (
        <>
          <ResponsiveEditOverlay
            open={editSceneOpen}
            onOpenChange={requestCloseSceneEditor}
            title="编辑场次"
            description="修改场次标题、时间、地点和氛围；应用后写入当前活动草稿。"
            footer={(
              <div className="flex w-full justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => requestCloseSceneEditor(false)}>取消</Button>
                <Button type="button" onClick={applySceneDraft} disabled={disabled}>应用修改</Button>
              </div>
            )}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-ink">场次标题</span>
                <Input autoFocus value={sceneDraft.title} onChange={(event) => setSceneDraft({ ...sceneDraft, title: event.target.value })} placeholder="为这一场添加标题" disabled={disabled} />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-ink">时间</span>
                <Input value={sceneDraft.timeText} onChange={(event) => setSceneDraft({ ...sceneDraft, timeText: event.target.value })} placeholder="如：傍晚 18:30" disabled={disabled} />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-ink">地点</span>
                <Input value={sceneDraft.locationText} onChange={(event) => setSceneDraft({ ...sceneDraft, locationText: event.target.value })} placeholder="记录本场次的具体地点" disabled={disabled} />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-ink">氛围（可选）</span>
                <Textarea rows={3} value={sceneDraft.environment} onChange={(event) => setSceneDraft({ ...sceneDraft, environment: event.target.value })} placeholder="补充天气、光线或现场氛围" disabled={disabled} />
              </label>
            </div>
          </ResponsiveEditOverlay>
          <ConfirmDialog
            open={discardSceneOpen}
            onOpenChange={setDiscardSceneOpen}
            title="放弃场次修改？"
            description="弹窗中的修改尚未应用，关闭后这些临时内容将被丢弃。"
            cancelLabel="继续编辑"
            confirmLabel="放弃修改"
            onConfirm={discardSceneDraft}
          />
        </>
      )}

      {/* 3. 核心双栏工作台：黄金比例 4:6 (左 40% 剧本流，右 60% 镜头工坊) */}
      {currentScene && (
        <div className="flex-1 flex overflow-hidden min-h-0 gap-3">

          {/* 左侧：分镜镜头时间线 (Master Shot List, 占 40%) */}
          <div
            className={`${
              isNarrowViewport
                ? isInspectorCollapsed ? 'flex-1 w-full' : 'hidden'
                : isInspectorCollapsed ? 'flex-1 w-full' : 'w-[40%] xl:w-[38%] min-w-[320px] shrink-0'
            } h-full flex flex-col min-w-0 bg-surface rounded-xl border border-border-default overflow-hidden shadow-2xs transition-all`}
          >
            {/* 列表工具条 */}
            <div className="px-3.5 py-2 border-b border-border-default bg-surface-muted/30 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink flex items-center gap-1.5">
                  <Film className="h-3.5 w-3.5 text-accent" />
                  <span>分镜镜头序列</span>
                </span>
                <span className="px-1.5 py-0.2 rounded bg-surface-muted text-[10px] text-muted font-mono font-bold">
                  {currentScene.beats.length} 镜
                </span>
              </div>
              <span className="text-[10px] text-muted hidden sm:inline">
                点击卡片联动右侧工坊
              </span>
            </div>

            {/* 镜头列表（独立局部滚动，高度锁定） */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {currentScene.beats.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted border border-dashed border-border-default rounded-xl space-y-2">
                  <p>本场次暂无分镜动作</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddBeat(currentScene)}
                    className="text-xs"
                  >
                    + 添加第 1 个分镜卡片
                  </Button>
                </div>
              ) : (
                currentScene.beats.map((beat, beatIdx) => {
                  const actor = beat.characterId ? actorMap.get(beat.characterId) : undefined;
                  const isNarrator = beat.characterId === 'narrator' || !beat.characterId;
                  const isSelected = currentBeat?.id === beat.id;
                  const avatarUrl = getCharacterAvatar(beat.characterId, actor);

                  return (
                    <div
                      key={beat.id}
                      data-testid="activity-beat-card"
                      onClick={() => {
                        setSelectedBeatId(beat.id);
                        if (isInspectorCollapsed) setIsInspectorCollapsed(false);
                      }}
                      className={`group relative rounded-xl border p-2.5 sm:p-3 transition-all cursor-pointer flex items-start gap-2.5 ${
                        isSelected
                          ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-2xs'
                          : 'border-border-default bg-surface hover:border-accent/40 hover:bg-surface-muted/20 shadow-2xs'
                      }`}
                    >
                      {/* 镜号 */}
                      <div className="flex flex-col items-center justify-between self-stretch shrink-0 w-6 py-0.5 text-muted">
                        <span className={`font-mono text-[11px] font-bold ${isSelected ? 'text-accent' : 'text-muted'}`}>
                          #{beatIdx + 1 < 10 ? `0${beatIdx + 1}` : beatIdx + 1}
                        </span>
                      </div>

                      {/* 角色头像与名称 (穿透直连角色卡官方头像) */}
                      <div className="shrink-0 flex flex-col items-center gap-1 w-12">
                        <div className="relative h-8 w-8 rounded-full overflow-hidden border border-border-default bg-surface-muted shrink-0 shadow-2xs">
                          {avatarUrl ? (
                            <Image
                              src={avatarUrl}
                              alt={actor?.displayName || '角色头像'}
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-accent bg-accent/10">
                              {isNarrator ? '旁' : actor?.displayName?.slice(0, 1) || '角'}
                            </div>
                          )}
                        </div>
                        <span
                          className="text-[10px] font-bold text-ink text-center leading-tight truncate w-full"
                          title={actor?.displayName || '旁白'}
                        >
                          {isNarrator ? '旁白' : actor?.displayName || '角色'}
                        </span>
                      </div>

                      {/* 核心剧本内容：动作 · 台词 · 产出 */}
                      <div className="flex-1 min-w-0 space-y-1">
                        {/* 动作描述 */}
                        <div className="text-xs font-medium text-ink leading-relaxed">
                          {beat.action ? (
                            <span className="line-clamp-2">{beat.action}</span>
                          ) : (
                            <span className="text-muted/60 italic text-[11px]">点击在右侧工坊输入动作描述...</span>
                          )}
                        </div>

                        {/* 台词气泡 */}
                        {beat.dialogue && (
                          <div className="text-[11px] text-ink/80 font-serif italic line-clamp-1 bg-surface-muted/60 px-2 py-0.5 rounded border border-border-subtle inline-block max-w-full">
                            “{beat.dialogue}”
                          </div>
                        )}

                        {/* 结果事实胶囊 */}
                        {beat.outcome && (
                          <div className="pt-0.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 max-w-full truncate">
                              <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{beat.outcome}</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 右侧媒体渲染微状态 */}
                      <div className="shrink-0 flex items-center gap-1.5 self-center pl-1">
                        {beat.mediaUrl ? (
                          <div className="relative h-9 w-14 rounded-md overflow-hidden bg-black/90 border border-border-default shadow-2xs shrink-0">
                            {beat.mediaType === 'video' ? (
                              <video src={beat.mediaUrl} className="h-full w-full object-cover" />
                            ) : (
                              <Image src={beat.mediaUrl} alt="分镜媒体" fill unoptimized className="object-cover" />
                            )}
                            <div className="absolute bottom-0.5 right-0.5 px-0.5 rounded bg-black/80 text-[6px] text-white font-mono font-bold">
                              {beat.mediaType === 'video' ? 'VID' : 'IMG'}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[9px] text-muted/60 bg-surface-muted/60 px-1.5 py-0.5 rounded border border-dashed border-border-subtle shrink-0">
                            待绘
                          </div>
                        )}

                        {/* 悬停快捷排序与删除 */}
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveBeat(currentScene, beatIdx, 'up');
                            }}
                            disabled={beatIdx === 0 || disabled}
                            className="p-1 rounded hover:bg-surface-hover text-muted hover:text-ink disabled:opacity-20 cursor-pointer"
                            title="上移"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveBeat(currentScene, beatIdx, 'down');
                            }}
                            disabled={beatIdx === currentScene.beats.length - 1 || disabled}
                            className="p-1 rounded hover:bg-surface-hover text-muted hover:text-ink disabled:opacity-20 cursor-pointer"
                            title="下移"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBeat(currentScene, beat.id);
                            }}
                            disabled={disabled}
                            className="p-1 rounded hover:bg-red-50 text-muted hover:text-red-600 cursor-pointer"
                            title="删除分镜"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* 列表底部快捷插入按钮 */}
              <button
                type="button"
                onClick={() => handleAddBeat(currentScene)}
                disabled={disabled}
                className="w-full py-2 rounded-xl border border-dashed border-border-default hover:border-accent hover:bg-surface-muted/30 text-muted hover:text-accent text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>追加下一镜</span>
              </button>
            </div>
          </div>

          {/* 右侧：镜头视听工坊 (Studio & Inspector, 占 60% 黄金比例) */}
          {!isInspectorCollapsed && currentBeat && (
            <aside className={`${isNarrowViewport ? 'w-full flex-none' : 'flex-1'} h-full min-w-0 flex flex-col bg-surface rounded-xl border border-border-default overflow-hidden shadow-2xs animate-in fade-in slide-in-from-right-2 duration-200`}>
              {/* 镜头工作台：工作流预览、异步候选与人工采纳 */}
              <div className="px-4 py-2 border-b border-border-default bg-surface-muted/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-ink flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
                    <span>镜头 #{currentBeatIndex + 1} 视听工坊</span>
                  </span>
                  <span className="text-[10px] text-muted font-mono truncate max-w-[120px]">{currentBeat.characterName || '旁白'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInspectorCollapsed(true)}
                  className="text-xs text-muted hover:text-ink p-1 rounded hover:bg-surface cursor-pointer"
                  aria-label={isNarrowViewport ? '返回分镜列表' : '收起工坊'}
                  title={isNarrowViewport ? '返回分镜列表' : '收起工坊'}
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs">
                {activityId ? <BeatRenderWorkbench
                  activityId={activityId}
                  stageId={stage.id}
                  scene={currentScene}
                  beat={currentBeat}
                  document={document}
                  onBeforeAction={onBeforeMediaGeneration}
                  onAdopted={(nextDocument, draftVersion) => {
                    documentRef.current = nextDocument;
                    if (onAdoptMediaResult) onAdoptMediaResult(nextDocument, draftVersion);
                    else onUpdateDocument(nextDocument);
                  }}
                  onAutoAppliedCheck={onAutoAppliedCheck}
                  onSettingsChange={(renderSettings) => handleUpdateBeat(currentScene, currentBeat.id, { renderSettings })}
                  disabled={disabled}
                /> : <p className="text-sm text-muted">请先保存活动，再使用镜头渲染工作流。</p>}
                <div className="border-t border-border-default pt-3">
                  <Button type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => setEditBeatOpen(true)}>编辑镜头内容</Button>
                </div>

                {/* 底部辅助试演 */}
                <div className="pt-2 border-t border-border-default">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPreviewScene(currentScene);
                      setPreviewOpen(true);
                    }}
                    className="w-full h-8 text-xs font-semibold text-accent border-accent/30 hover:bg-accent/10"
                  >
                    <Play className="h-3 w-3 mr-1" />
                    <span>试演本场（进入沉浸播放器）</span>
                  </Button>
                </div>

              </div>
            </aside>
          )}

        </div>
      )}

      {/* 沉浸式试演抽屉 */}
      {isNarrowViewport
        ? <Drawer open={editBeatOpen} onOpenChange={setEditBeatOpen} position="bottom" title="编辑镜头" description="角色、动作和剧情信息会用于编译镜头描述。">{beatEditorForm}</Drawer>
        : <Dialog open={editBeatOpen} onOpenChange={setEditBeatOpen} title="编辑镜头" description="角色、动作和剧情信息会用于编译镜头描述。">{beatEditorForm}</Dialog>}
      <ScenePreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        scene={previewScene}
        actors={actors}
      />
    </div>
  );
}
