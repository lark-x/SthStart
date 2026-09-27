'use client';

import { useSearchParams } from 'next/navigation';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  MessageSquare,
  Share2,
  Heart,
  Plus,
  Trash2,
  Sparkles,
  Send,
  FileCheck,
  Info,
  X,
  Lock,
  Unlock,
  Settings2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Edit3,
  Check,
  RefreshCw,
  Camera,
  Layers,
  HelpCircle,
  Clock,
  User,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  ActorSnapshot,
  StageDefinition,
  ContentDocument,
  ChatMessage,
  MomentPost,
  MomentComment,
  MomentLike,
  ActivityFact,
  MediaSlot,
} from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Select } from '@/app/components/ui/select';
import { Drawer } from '@/app/components/ui/drawer';
import { useWideDetailColumn } from '@/app/lib/use-wide-detail-column';

interface RecordsEditorProps {
  document: ContentDocument;
  stages: StageDefinition[];
  actors: ActorSnapshot[];
  currentStageId?: string;
  onSelectStage?: (stageId: string) => void;
  onUpdateDocument: (doc: ContentDocument) => void;
  onOpenWorkbench?: (slotId: string) => void;
  /**
   * 视图由外层工作室控制：剧本流 / 群聊 / 朋友圈 / 事件
   */
  activeView?: 'settings' | 'chat' | 'moments' | 'facts' | 'script';
  onActiveViewChange?: (view: 'chat' | 'moments' | 'facts' | 'script') => void;
  hideStageSelector?: boolean;
  hideViewTabs?: boolean;
  disabled?: boolean;
}

export function RecordsEditor({
  document,
  stages,
  actors,
  currentStageId,
  onSelectStage,
  onUpdateDocument,
  onOpenWorkbench,
  activeView,
  onActiveViewChange,
  hideStageSelector = false,
  hideViewTabs = false,
  disabled,
}: RecordsEditorProps) {
  const searchParams = useSearchParams();
  const linkedRecord = [...document.messages, ...document.posts].find((r) => r.id === searchParams.get('recordId'));

  // 阶段选择状态
  const [selectedStageId, setSelectedStageId] = useState<string>(
    document.facts.find((f) => f.id === searchParams.get('factId'))?.stageId ||
      linkedRecord?.stageId ||
      searchParams.get('stageId') ||
      currentStageId ||
      stages[0]?.id ||
      ''
  );

  useEffect(() => {
    if (currentStageId && currentStageId !== selectedStageId) {
      setSelectedStageId(currentStageId);
    }
  }, [currentStageId, selectedStageId]);

  // 内部视图状态（默认采用剧本故事流）
  const [internalTab, setActiveTab] = useState<'script' | 'chat' | 'moments' | 'facts'>('script');
  const activeTab: 'script' | 'chat' | 'moments' | 'facts' =
    activeView && activeView !== 'settings' ? (activeView as 'script' | 'chat' | 'moments' | 'facts') : internalTab;

  const selectView = (view: 'script' | 'chat' | 'moments' | 'facts') => {
    setActiveTab(view);
    onActiveViewChange?.(view);
  };

  // 当前阶段对象
  const currentStage = useMemo(
    () => stages.find((s) => s.id === selectedStageId) || stages[0],
    [stages, selectedStageId]
  );
  const currentStageIndex = useMemo(
    () => stages.findIndex((s) => s.id === selectedStageId),
    [stages, selectedStageId]
  );

  // 严格按当前阶段过滤数据，解决多阶段重复显示问题
  const stageMessages = useMemo(
    () => (document.messages || []).filter((m) => m.stageId === selectedStageId),
    [document.messages, selectedStageId]
  );
  const stagePosts = useMemo(
    () => (document.posts || []).filter((p) => p.stageId === selectedStageId),
    [document.posts, selectedStageId]
  );
  const stagePostIds = useMemo(() => new Set(stagePosts.map((p) => p.id)), [stagePosts]);
  const stageComments = useMemo(
    () => (document.comments || []).filter((c) => stagePostIds.has(c.postId)),
    [document.comments, stagePostIds]
  );
  const stageLikes = useMemo(
    () => (document.likes || []).filter((l) => stagePostIds.has(l.postId)),
    [document.likes, stagePostIds]
  );
  const stageFacts = useMemo(
    () => (document.facts || []).filter((f) => f.stageId === selectedStageId),
    [document.facts, selectedStageId]
  );
  const stageMediaSlots = useMemo(
    () => (document.mediaSlots || []).filter((s) => s.stageId === selectedStageId),
    [document.mediaSlots, selectedStageId]
  );

  // 角色索引
  const actorMap = useMemo(() => new Map(actors.map((a) => [a.id, a])), [actors]);

  // 会话 ID
  const selectedConversationId = useMemo(() => {
    const first = stageMessages[0];
    return first?.conversationId || document.conversations[0]?.id || 'group_main';
  }, [stageMessages, document.conversations]);

  // 锁定状态映射
  const lockedRecordMap = useMemo(() => {
    const map = new Map<string, 'message' | 'post'>();
    for (const rec of document.editingPolicy?.lockedRecords || []) {
      map.set(rec.id, rec.kind);
    }
    return map;
  }, [document.editingPolicy]);

  // 仅编辑实际接入文本任务提示词的阶段主旨和系统覆盖；旧 MCP 字段原样保留。
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [stagePremise, setStagePremise] = useState('');
  const [stageSystemPromptOverride, setStageSystemPromptOverride] = useState('');

  // 同步阶段配置到本地状态
  useEffect(() => {
    if (currentStage) {
      setStagePremise(currentStage.stagePremise || '');
      setStageSystemPromptOverride(currentStage.systemPromptOverride || '');
    }
  }, [currentStage]);

  // 保存阶段主旨与系统提示词覆盖；对象展开会保留未展示的旧 MCP 字段。
  const handleSaveStageConfig = useCallback(() => {
    if (!currentStage) return;
    const nextStages = stages.map((s) =>
      s.id === currentStage.id
        ? {
            ...s,
            stagePremise: stagePremise.trim() || undefined,
            systemPromptOverride: stageSystemPromptOverride.trim() || undefined,
          }
        : s
    );
    onUpdateDocument({
      ...document,
      stages: nextStages,
    });
  }, [currentStage, stagePremise, stageSystemPromptOverride, stages, document, onUpdateDocument]);

  // 锁定/解锁单条记录
  const handleToggleRecordLock = (kind: 'message' | 'post', id: string) => {
    const currentLocked = document.editingPolicy?.lockedRecords || [];
    const isLocked = currentLocked.some((r) => r.id === id);
    const nextLocked = isLocked ? currentLocked.filter((r) => r.id !== id) : [...currentLocked, { kind, id }];
    onUpdateDocument({
      ...document,
      editingPolicy: {
        lockedRecords: nextLocked,
        lockedMediaSlotIds: document.editingPolicy?.lockedMediaSlotIds || [],
      },
    });
  };

  // 快捷追加消息/台词
  const [composerActorId, setComposerActorId] = useState<string>(actors[0]?.id || '');
  const [composerText, setComposerText] = useState('');
  const [composerTime, setComposerTime] = useState('');

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composerText.trim() || !composerActorId) return;

    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId: selectedConversationId,
      stageId: selectedStageId,
      kind: 'message',
      speakerActorId: composerActorId,
      text: composerText.trim(),
      mediaSlotIds: [],
      storyOrder: (stageMessages.length + 1) * 10,
      storyTimeLabel: composerTime.trim() || undefined,
    };

    onUpdateDocument({
      ...document,
      messages: [...(document.messages || []), newMsg],
    });
    setComposerText('');
    setComposerTime('');
  };

  // 行内编辑消息
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgText, setEditingMsgText] = useState('');

  const handleStartEditMsg = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditingMsgText(msg.text);
  };

  const handleSaveEditMsg = (msgId: string) => {
    if (!editingMsgText.trim()) return;
    onUpdateDocument({
      ...document,
      messages: (document.messages || []).map((m) =>
        m.id === msgId ? { ...m, text: editingMsgText.trim() } : m
      ),
    });
    setEditingMsgId(null);
  };

  const handleDeleteMessage = (msgId: string) => {
    if (lockedRecordMap.has(msgId)) {
      alert('此消息已被锁定保护，请先解锁后再删除。');
      return;
    }
    onUpdateDocument({
      ...document,
      messages: (document.messages || []).filter((m) => m.id !== msgId),
    });
  };

  // 动态操作
  const [postAuthorId, setPostAuthorId] = useState<string>(actors[0]?.id || '');
  const [postText, setPostText] = useState('');

  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!postText.trim() || !postAuthorId) return;

    const newPost: MomentPost = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      stageId: selectedStageId,
      authorActorId: postAuthorId,
      text: postText.trim(),
      mediaSlotIds: [],
      storyOrder: (stagePosts.length + 1) * 10,
      sourceFactIds: [],
    };

    onUpdateDocument({
      ...document,
      posts: [...(document.posts || []), newPost],
    });
    setPostText('');
  };

  const handleDeletePost = (postId: string) => {
    if (lockedRecordMap.has(postId)) {
      alert('此动态已被锁定保护，请先解锁后再删除。');
      return;
    }
    onUpdateDocument({
      ...document,
      posts: (document.posts || []).filter((p) => p.id !== postId),
      comments: (document.comments || []).filter((c) => c.postId !== postId),
      likes: (document.likes || []).filter((l) => l.postId !== postId),
    });
  };

  const handleToggleLike = (postId: string, actorId: string) => {
    const currentLikes = document.likes || [];
    const hasLiked = currentLikes.some((l) => l.postId === postId && l.actorId === actorId);
    const updatedLikes = hasLiked
      ? currentLikes.filter((l) => !(l.postId === postId && l.actorId === actorId))
      : [...currentLikes, { postId, actorId }];
    onUpdateDocument({ ...document, likes: updatedLikes });
  };

  const handleAddComment = (postId: string, actorId: string, text: string) => {
    if (!text.trim()) return;
    const newComment: MomentComment = {
      id: `comm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      postId,
      authorActorId: actorId,
      text: text.trim(),
      storyOrder: ((document.comments || []).filter((c) => c.postId === postId).length + 1) * 10,
    };
    onUpdateDocument({
      ...document,
      comments: [...(document.comments || []), newComment],
    });
  };

  // 事实操作
  const [factText, setFactText] = useState('');
  const handleAddFact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!factText.trim()) return;

    const newFact: ActivityFact = {
      id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      stageId: selectedStageId,
      text: factText.trim(),
      status: 'happened',
      sourceRecordIds: [],
      knownByActorIds: actors.map((a) => a.id),
    };

    onUpdateDocument({
      ...document,
      facts: [...(document.facts || []), newFact],
    });
    setFactText('');
  };

  const handleDeleteFact = (factId: string) => {
    onUpdateDocument({
      ...document,
      facts: (document.facts || []).filter((f) => f.id !== factId),
    });
  };

  // 详情抽屉/侧栏
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const wideDetailColumn = useWideDetailColumn();
  const selectedMessage = stageMessages.find((msg) => msg.id === selectedMessageId);
  const selectedSpeaker = selectedMessage?.speakerActorId ? actorMap.get(selectedMessage.speakerActorId) : undefined;

  return (
    <div className="w-full space-y-4">
      {/* 阶段选择器（仅在独立未由外层托管时显示） */}
      {!hideStageSelector && (
        <div className="flex items-center gap-2 p-2.5 rounded-[var(--radius-panel)] bg-surface border border-border-default overflow-x-auto">
          <span className="text-xs font-semibold text-muted px-2 shrink-0">当前阶段：</span>
          {stages.map((stage, idx) => {
            const isSelected = selectedStageId === stage.id;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => {
                  setSelectedStageId(stage.id);
                  onSelectStage?.(stage.id);
                }}
                className={`px-3 py-1.5 rounded-[var(--radius-control)] text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  isSelected ? 'bg-accent text-white shadow-xs' : 'bg-surface-muted text-ink hover:bg-surface-hover'
                }`}
              >
                #{idx + 1} {stage.title}
              </button>
            );
          })}
        </div>
      )}

      {/* 阶段提示词配置 */}
      <div className="rounded-[var(--radius-panel)] bg-surface border border-border-default shadow-xs overflow-hidden">
        <div className="p-4 space-y-3 bg-linear-to-r from-surface to-surface-raised">
          {/* 阶段标题与概览 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="px-2.5 py-1 rounded-md bg-accent/15 text-accent font-bold text-xs shrink-0">
                第 {currentStageIndex >= 0 ? currentStageIndex + 1 : 1} 幕
              </span>
              <h2 className="text-sm font-bold text-ink truncate">
                {currentStage?.title || '未命名阶段'}
              </h2>
              {currentStage?.location && (
                <span className="text-xs text-muted shrink-0 flex items-center gap-1">
                  📍 {currentStage.location}
                </span>
              )}
              {currentStage?.stagePremise && (
                <span className="text-xs text-accent font-medium bg-accent/10 px-2 py-0.5 rounded truncate max-w-[280px]">
                  主旨：{currentStage.stagePremise}
                </span>
              )}
            </div>

            {/* 控制按钮组 */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowConfigPanel(!showConfigPanel)}
                className="h-8 text-xs flex items-center gap-1.5 border-border-default hover:bg-surface-hover"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
                <span>阶段提示词配置</span>
                {showConfigPanel ? <ChevronUp className="h-3 w-3 text-muted" /> : <ChevronDown className="h-3 w-3 text-muted" />}
              </Button>

            </div>
          </div>

          {/* 折叠区域：只保留实际接入文本提示词的字段 */}
          {showConfigPanel && (
            <div className="pt-3 mt-1 border-t border-border-subtle grid grid-cols-1 gap-4 text-xs">
              {/* 阶段主旨与事件目标 */}
              <div className="space-y-2">
                <label className="block font-semibold text-ink flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-accent" />
                  <span>阶段核心主旨与戏剧冲突</span>
                </label>
                <Textarea
                  value={stagePremise}
                  onChange={(e) => setStagePremise(e.target.value)}
                  placeholder="设定本阶段的核心事件冲突、角色情感变化与剧情发展目标（大模型将严格围绕该主旨生成）..."
                  className="h-18 text-xs bg-surface"
                />
                <p className="text-[11px] text-muted">
                  此主旨会与全局活动主题结合，引导大模型产生符合本幕节奏的对话与动态。
                </p>
              </div>

              {/* 系统提示词覆盖 */}
              <div className="space-y-2">
                <div className="pt-2 space-y-1">
                  <label className="block font-medium text-muted text-[11px]">
                    阶段专属系统提示词微调 (System Prompt Override，可选):
                  </label>
                  <Input
                    value={stageSystemPromptOverride}
                    onChange={(e) => setStageSystemPromptOverride(e.target.value)}
                    placeholder="未填写时继承策划方案设定的全局系统提示词..."
                    className="h-7 text-xs bg-surface"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveStageConfig}
                    className="h-7 text-xs px-3 bg-accent text-white"
                  >
                    保存本阶段配置
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 独立入口仍可管理子视图；嵌入工作台时由外层统一提供 */}
        {!hideViewTabs && <div className="flex flex-wrap items-center justify-between border-t border-border-default px-4 py-2 bg-surface-muted/30 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => selectView('script')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-control)] font-semibold transition-colors cursor-pointer ${
                activeTab === 'script' ? 'bg-accent text-white shadow-2xs' : 'text-muted hover:text-ink'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>剧本故事流</span>
              <span className="font-mono">({stageMessages.length + stagePosts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => selectView('chat')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-control)] font-semibold transition-colors cursor-pointer ${
                activeTab === 'chat' ? 'bg-accent text-white shadow-2xs' : 'text-muted hover:text-ink'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>对话台词 ({stageMessages.length})</span>
            </button>
            <button
              type="button"
              onClick={() => selectView('moments')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-control)] font-semibold transition-colors cursor-pointer ${
                activeTab === 'moments' ? 'bg-accent text-white shadow-2xs' : 'text-muted hover:text-ink'
              }`}
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>朋友圈 ({stagePosts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => selectView('facts')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-control)] font-semibold transition-colors cursor-pointer ${
                activeTab === 'facts' ? 'bg-accent text-white shadow-2xs' : 'text-muted hover:text-ink'
              }`}
            >
              <FileCheck className="h-3.5 w-3.5" />
              <span>剧情事实 ({stageFacts.length})</span>
            </button>
          </div>

        </div>}
      </div>

      {/* 2. 主体：根据所选视图展示内容 */}
      {/* 2.1 剧本故事流视图 (Script View - 默认主界面) */}
      {(activeTab === 'script' || activeTab === 'chat') && (
        <div
          className={
            wideDetailColumn && selectedMessage
              ? 'grid gap-5 grid-cols-[minmax(0,1fr)_320px]'
              : 'space-y-4'
          }
        >
          <div className="space-y-4">
            {/* 剧本流卡片列表 */}
            <div className="rounded-[var(--radius-panel)] bg-surface border border-border-default p-4 sm:p-6 min-h-[400px] space-y-4">
              {stageMessages.length === 0 && stagePosts.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted space-y-3">
                  <Layers className="h-10 w-10 mx-auto text-accent opacity-60" />
                  <p className="font-semibold text-ink text-base">本阶段暂无剧情内容</p>
                  <p className="text-xs max-w-md mx-auto leading-relaxed">
                    可在右侧 AI 面板生成文本候选；候选会先进入审阅，不会自动写入。
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 对话与动态故事流 */}
                  {stageMessages.map((msg, idx) => {
                    const speaker = msg.speakerActorId ? actorMap.get(msg.speakerActorId) : undefined;
                    const isEditing = editingMsgId === msg.id;

                    return (
                      <div
                        key={msg.id}
                        id={`record-${msg.id}`}
                        className="flex items-start gap-3 group p-2.5 rounded-lg hover:bg-surface-muted/40 transition-colors"
                      >
                        {/* 角色立绘头像 */}
                        <div className="h-9 w-9 rounded-full bg-surface-hover overflow-hidden shrink-0 flex items-center justify-center text-xs font-semibold text-ink border border-border-subtle">
                          {speaker?.avatarUrl || speaker?.appearanceReferenceAssetKeys?.[0] ? (
                            <Image
                              src={speaker.avatarUrl || speaker.appearanceReferenceAssetKeys?.[0] || ''}
                              alt={speaker.displayName}
                              width={36}
                              height={36}
                              className="object-cover h-full w-full"
                            />
                          ) : (
                            speaker?.displayName?.slice(0, 1) || '?'
                          )}
                        </div>

                        {/* 台词与信息 */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-ink">{speaker?.displayName || msg.speakerActorId || '系统'}</span>
                            {speaker?.activityRole && (
                              <span className="text-[10px] text-muted bg-surface-muted px-1.5 py-0.2 rounded font-normal">
                                {speaker.activityRole}
                              </span>
                            )}
                            {msg.storyTimeLabel && (
                              <span className="text-[11px] text-muted font-mono flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {msg.storyTimeLabel}
                              </span>
                            )}
                            <span className="text-[10px] text-muted font-mono opacity-60">#{idx + 1}</span>

                            {lockedRecordMap.has(msg.id) && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
                                <Lock className="h-2.5 w-2.5" /> 已锁定
                              </span>
                            )}
                          </div>

                          {/* 行内编辑或常规展示 */}
                          {isEditing ? (
                            <div className="space-y-2 pt-1">
                              <Textarea
                                value={editingMsgText}
                                onChange={(e) => setEditingMsgText(e.target.value)}
                                className="text-xs h-16 bg-surface"
                                autoFocus
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleSaveEditMsg(msg.id)}
                                  className="h-6 text-[11px] px-2.5 bg-accent text-white"
                                >
                                  保存
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingMsgId(null)}
                                  className="h-6 text-[11px] px-2"
                                >
                                  取消
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={() => setSelectedMessageId(msg.id)}
                              className={`p-3 rounded-lg text-xs leading-relaxed text-ink bg-surface-raised border border-border-subtle cursor-pointer hover:border-accent/40 transition-colors ${
                                selectedMessageId === msg.id ? 'ring-2 ring-accent ring-offset-1' : ''
                              }`}
                            >
                              {msg.text}
                            </div>
                          )}

                          {/* 关联媒体镜头 */}
                          {msg.mediaSlotIds && msg.mediaSlotIds.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {msg.mediaSlotIds.map((slotId) => (
                                <button
                                  key={slotId}
                                  type="button"
                                  onClick={() => onOpenWorkbench?.(slotId)}
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition cursor-pointer"
                                  title="打开 AI 生图与分镜工作台"
                                >
                                  <Camera className="h-3 w-3 text-amber-600" />
                                  <span>分镜插槽:</span>
                                  <span className="font-mono font-semibold">{slotId}</span>
                                  <Sparkles className="w-2.5 h-2.5 text-amber-500" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 行级快捷操作 */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity self-start pt-1">
                          <button
                            type="button"
                            onClick={() => handleStartEditMsg(msg)}
                            className="p-1 text-muted hover:text-ink rounded hover:bg-surface-hover"
                            title="编辑此句台词"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleRecordLock('message', msg.id)}
                            className={`p-1 rounded hover:bg-surface-hover ${
                              lockedRecordMap.has(msg.id) ? 'text-amber-600' : 'text-muted hover:text-ink'
                            }`}
                            title={lockedRecordMap.has(msg.id) ? '解锁此台词' : '锁定此台词（防止大模型重新生成时覆盖）'}
                          >
                            {lockedRecordMap.has(msg.id) ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            disabled={lockedRecordMap.has(msg.id)}
                            className="p-1 text-muted hover:text-danger-fg rounded hover:bg-surface-hover disabled:opacity-30"
                            title="删除此台词"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 底部：快捷追加台词/旁白条 */}
            <form
              onSubmit={handleSendMessage}
              className="flex items-center gap-2 p-2 rounded-[var(--radius-panel)] bg-surface border border-border-default shadow-2xs"
            >
              <div className="w-32 shrink-0">
                <Select
                  value={composerActorId}
                  onChange={(e) => setComposerActorId(e.target.value)}
                  disabled={disabled}
                  className="h-8 text-xs bg-transparent border-0 ring-0 focus:ring-0"
                >
                  {actors.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.displayName}
                    </option>
                  ))}
                </Select>
              </div>

              <Input
                value={composerTime}
                onChange={(e) => setComposerTime(e.target.value)}
                placeholder="时间(如 10:00)"
                className="w-24 h-8 text-xs bg-transparent border-border-subtle"
              />

              <Input
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder="追加角色台词或剧本旁白，按回车快速添加…"
                disabled={disabled}
                className="h-8 text-xs flex-1 bg-transparent border-0 ring-0 focus:ring-0 focus-visible:ring-0"
              />

              <Button
                type="submit"
                size="sm"
                disabled={disabled || !composerText.trim()}
                className="h-8 px-3 text-xs bg-accent hover:bg-accent-dark text-white flex items-center gap-1 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>追加</span>
              </Button>
            </form>
          </div>

          {/* 宽屏右侧记录详情 */}
          {wideDetailColumn && selectedMessage && (
            <aside className="sticky top-20 h-fit rounded-[var(--radius-panel)] bg-surface border border-border-default p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xs font-bold text-ink">记录详情</h3>
                <button
                  type="button"
                  onClick={() => setSelectedMessageId(null)}
                  className="text-muted hover:text-ink p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-muted">说话人：</span>
                  <span className="font-semibold text-ink ml-1">{selectedSpeaker?.displayName || '未指定'}</span>
                </div>
                <div>
                  <span className="text-muted">活动角色：</span>
                  <span className="text-ink ml-1">{selectedSpeaker?.activityRole || '未标注'}</span>
                </div>
                <div>
                  <span className="text-muted">时间标记：</span>
                  <span className="text-ink ml-1 font-mono">{selectedMessage.storyTimeLabel || '未设置'}</span>
                </div>
                <div>
                  <span className="text-muted">内容：</span>
                  <p className="mt-1 p-2 bg-surface-muted rounded text-ink leading-relaxed break-words">
                    {selectedMessage.text}
                  </p>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* 2.2 朋友圈动态视图 */}
      {activeTab === 'moments' && (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-panel)] bg-surface border border-border-default p-4 sm:p-6 min-h-[300px] space-y-4">
            {stagePosts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted space-y-2">
                <Share2 className="h-8 w-8 mx-auto text-muted opacity-60" />
                <p>本阶段还没有朋友圈动态</p>
                <p className="text-xs">可在右侧 AI 面板生成朋友圈候选，审阅确认后再采用。</p>
              </div>
            ) : (
              stagePosts.map((post) => {
                const author = actorMap.get(post.authorActorId);
                const postLikes = stageLikes.filter((l) => l.postId === post.id);
                const postComments = stageComments.filter((c) => c.postId === post.id);

                return (
                  <div key={post.id} className="p-4 rounded-lg bg-surface-raised border border-border-subtle space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-surface-hover overflow-hidden flex items-center justify-center text-xs font-semibold text-ink">
                          {author?.displayName?.slice(0, 1) || '?'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-ink">{author?.displayName || '未知角色'}</p>
                          <p className="text-[10px] text-muted">{author?.activityRole}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleRecordLock('post', post.id)}
                          className="p-1 text-muted hover:text-ink"
                          title={lockedRecordMap.has(post.id) ? '已锁定' : '未锁定'}
                        >
                          {lockedRecordMap.has(post.id) ? <Lock className="h-3 w-3 text-amber-600" /> : <Unlock className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePost(post.id)}
                          disabled={lockedRecordMap.has(post.id)}
                          className="p-1 text-muted hover:text-danger-fg disabled:opacity-30"
                          title="删除动态"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-ink leading-relaxed break-words">{post.text}</p>

                    {/* 点赞与评论 */}
                    <div className="pt-2 border-t border-border-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleLike(post.id, actors[0]?.id || '')}
                          className="flex items-center gap-1 text-muted hover:text-accent cursor-pointer"
                        >
                          <Heart className="h-3.5 w-3.5" />
                          <span>{postLikes.length} 赞</span>
                        </button>
                        <span className="text-muted">💬 {postComments.length} 条互动</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 2.3 剧情事实沉淀视图 */}
      {activeTab === 'facts' && (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-panel)] bg-surface border border-border-default p-4 sm:p-6 min-h-[300px] space-y-3">
            {stageFacts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted space-y-2">
                <FileCheck className="h-8 w-8 mx-auto text-muted opacity-60" />
                <p>本阶段暂未沉淀剧情事实</p>
                <p className="text-xs">大模型生成完整阶段剧情时，会自动将关键对白提炼为本阶段已发生事实。</p>
              </div>
            ) : (
              stageFacts.map((fact) => (
                <div key={fact.id} className="p-3 rounded bg-surface-raised border border-border-subtle flex items-start justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 font-semibold text-[10px]">
                      {fact.status === 'happened' ? '✓ 已发生事实' : '○ 规划事实'}
                    </span>
                    <p className="text-ink font-medium leading-relaxed">{fact.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteFact(fact.id)}
                    className="text-muted hover:text-danger-fg p-1 shrink-0"
                    title="删除事实"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
