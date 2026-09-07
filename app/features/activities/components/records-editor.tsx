'use client';

import React, { useState, useMemo } from 'react';
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

interface RecordsEditorProps {
  document: ContentDocument;
  stages: StageDefinition[];
  actors: ActorSnapshot[];
  currentStageId?: string;
  onSelectStage?: (stageId: string) => void;
  onUpdateDocument: (doc: ContentDocument) => void;
  onOpenAiGenerator?: () => void;
  disabled?: boolean;
}

export function RecordsEditor({
  document,
  stages,
  actors,
  currentStageId,
  onSelectStage,
  onUpdateDocument,
  onOpenAiGenerator,
  disabled,
}: RecordsEditorProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'moments' | 'facts'>('chat');
  const [selectedStageId, setSelectedStageId] = useState<string>(
    currentStageId || stages[0]?.id || ''
  );

  // Message composer state
  const [composerActorId, setComposerActorId] = useState<string>(actors[0]?.id || '');
  const [composerText, setComposerText] = useState('');

  // Post composer state
  const [postAuthorId, setPostAuthorId] = useState<string>(actors[0]?.id || '');
  const [postText, setPostText] = useState('');

  // Fact composer state
  const [factText, setFactText] = useState('');

  // Actor lookup map
  const actorMap = useMemo(() => {
    return new Map(actors.map((a) => [a.id, a]));
  }, [actors]);

  const messages = document.messages || [];
  const posts = document.posts || [];
  const comments = document.comments || [];
  const likes = document.likes || [];
  const facts = document.facts || [];
  const mediaSlots = document.mediaSlots || [];

  const handleSelectStage = (id: string) => {
    setSelectedStageId(id);
    onSelectStage?.(id);
  };

  // Add chat message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composerText.trim() || !composerActorId) return;

    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId: 'group_main',
      stageId: selectedStageId,
      kind: 'message',
      speakerActorId: composerActorId,
      text: composerText.trim(),
      mediaSlotIds: [],
      storyOrder: (messages.length + 1) * 10,
    };

    onUpdateDocument({
      ...document,
      messages: [...messages, newMsg],
    });
    setComposerText('');
  };

  const handleDeleteMessage = (msgId: string) => {
    onUpdateDocument({
      ...document,
      messages: messages.filter((m) => m.id !== msgId),
    });
  };

  // Add moments post
  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!postText.trim() || !postAuthorId) return;

    const newPost: MomentPost = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      stageId: selectedStageId,
      authorActorId: postAuthorId,
      text: postText.trim(),
      mediaSlotIds: [],
      storyOrder: (posts.length + 1) * 10,
      sourceFactIds: [],
    };

    onUpdateDocument({
      ...document,
      posts: [...posts, newPost],
    });
    setPostText('');
  };

  const handleDeletePost = (postId: string) => {
    onUpdateDocument({
      ...document,
      posts: posts.filter((p) => p.id !== postId),
      comments: comments.filter((c) => c.postId !== postId),
      likes: likes.filter((l) => l.postId !== postId),
    });
  };

  // Toggle post like
  const handleToggleLike = (postId: string, actorId: string) => {
    const hasLiked = likes.some((l) => l.postId === postId && l.actorId === actorId);
    const updatedLikes = hasLiked
      ? likes.filter((l) => !(l.postId === postId && l.actorId === actorId))
      : [...likes, { postId, actorId }];
    onUpdateDocument({ ...document, likes: updatedLikes });
  };

  // Add comment to post
  const handleAddComment = (postId: string, actorId: string, text: string) => {
    if (!text.trim()) return;
    const newComment: MomentComment = {
      id: `comm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      postId,
      authorActorId: actorId,
      text: text.trim(),
      storyOrder: (comments.filter((c) => c.postId === postId).length + 1) * 10,
    };
    onUpdateDocument({
      ...document,
      comments: [...comments, newComment],
    });
  };

  // Add Fact
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
      facts: [...facts, newFact],
    });
    setFactText('');
  };

  const handleDeleteFact = (factId: string) => {
    onUpdateDocument({
      ...document,
      facts: facts.filter((f) => f.id !== factId),
    });
  };

  return (
    <div className="space-y-4">
      {/* Stage Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[4px_14px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)]">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <span className="text-xs font-semibold text-[#68716d] px-2 flex-shrink-0">当前阶段：</span>
          {stages.map((stage, idx) => {
            const isSelected = selectedStageId === stage.id;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => handleSelectStage(stage.id)}
                className={`px-3 py-1.5 rounded-[3px_10px_3px_3px] text-xs font-medium transition-colors cursor-pointer flex-shrink-0 ${
                  isSelected
                    ? 'bg-[#e45d35] text-white shadow-xs'
                    : 'bg-stone-100 text-[#18201d] hover:bg-stone-200'
                }`}
              >
                #{idx + 1} {stage.title}
              </button>
            );
          })}
        </div>

        {onOpenAiGenerator && (
          <Button
            type="button"
            size="sm"
            onClick={onOpenAiGenerator}
            disabled={disabled}
            className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 生成内容
          </Button>
        )}
      </div>

      {/* Mode Subtabs: Chat vs Moments vs Facts */}
      <div className="flex items-center gap-2 border-b border-[rgb(24_32_29/14%)] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'chat'
              ? 'text-[#e45d35] border-b-2 border-[#e45d35]'
              : 'text-[#68716d] hover:text-[#18201d]'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          群聊记录 ({messages.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('moments')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'moments'
              ? 'text-[#e45d35] border-b-2 border-[#e45d35]'
              : 'text-[#68716d] hover:text-[#18201d]'
          }`}
        >
          <Share2 className="h-4 w-4" />
          朋友圈动态 ({posts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('facts')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'facts'
              ? 'text-[#e45d35] border-b-2 border-[#e45d35]'
              : 'text-[#68716d] hover:text-[#18201d]'
          }`}
        >
          <FileCheck className="h-4 w-4" />
          阶段事实状态 ({facts.length})
        </button>
      </div>

      {/* 1. Chat Tab Content */}
      {activeTab === 'chat' && (
        <div className="space-y-4">
          <div className="rounded-[4px_14px_4px_4px] bg-[#faf8f2] border border-[rgb(24_32_29/14%)] p-4 min-h-[360px] max-h-[500px] overflow-y-auto space-y-3">
            {messages.length === 0 ? (
              <div className="py-16 text-center text-xs text-[#68716d] space-y-2">
                <MessageSquare className="h-8 w-8 mx-auto text-stone-400 opacity-60" />
                <p>当前活动尚无群聊记录</p>
                <p className="text-[11px]">可在下方直接输入对话，或点击右上角使用 AI 自动生成。</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const speaker = msg.speakerActorId ? actorMap.get(msg.speakerActorId) : undefined;
                const isUser = msg.speakerActorId === actors[0]?.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 group ${
                      isUser ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="h-8 w-8 rounded-full bg-stone-300 overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-semibold text-stone-700">
                      {speaker?.appearanceReferenceAssetKeys?.[0] ? (
                        <Image
                          src={speaker.appearanceReferenceAssetKeys[0]}
                          alt={speaker.displayName}
                          width={32}
                          height={32}
                          className="object-cover h-full w-full"
                        />
                      ) : (
                        speaker?.displayName?.slice(0, 1) || '?'
                      )}
                    </div>

                    {/* Bubble & Name */}
                    <div className={`space-y-1 max-w-[75%] ${isUser ? 'items-end text-right' : 'items-start'}`}>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#68716d]">
                        <span className="font-medium text-[#18201d]">
                          {speaker?.displayName || msg.speakerActorId || '系统'}
                        </span>
                        <span className="text-[10px] opacity-70">#{idx + 1}</span>
                      </div>
                      <div
                        className={`p-2.5 rounded-[4px_12px_4px_4px] text-xs leading-relaxed break-words shadow-2xs ${
                          isUser
                            ? 'bg-[#e45d35] text-white'
                            : 'bg-[#fffdf8] text-[#18201d] border border-[rgb(24_32_29/12%)]'
                        }`}
                      >
                        {msg.text}
                      </div>

                      {/* Associated media slots */}
                      {msg.mediaSlotIds && msg.mediaSlotIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {msg.mediaSlotIds.map((slotId) => (
                            <Badge key={slotId} variant="outline" className="text-[10px] bg-amber-50 text-amber-700">
                              📷 媒体槽位: {slotId}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Delete Action on Hover */}
                    <button
                      type="button"
                      onClick={() => handleDeleteMessage(msg.id)}
                      disabled={disabled}
                      className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-opacity self-center"
                      title="删除单条消息"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Chat Message Input Composer */}
          <form
            onSubmit={handleSendMessage}
            className="flex items-center gap-2 p-2 rounded-[4px_12px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)]"
          >
            <div className="w-32 flex-shrink-0">
              <Select
                value={composerActorId}
                onChange={(e) => setComposerActorId(e.target.value)}
                disabled={disabled}
                className="h-8 text-xs bg-transparent border-0 ring-0 focus:ring-0 min-h-0"
              >
                {actors.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.displayName}
                  </option>
                ))}
              </Select>
            </div>

            <Input
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              placeholder="在此输入群聊内容，按回车添加…"
              disabled={disabled}
              className="h-8 text-xs flex-1 bg-transparent border-0 ring-0 focus:ring-0 focus-visible:ring-0"
            />

            <Button
              type="submit"
              size="sm"
              disabled={disabled || !composerText.trim()}
              className="h-8 px-3 text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1"
            >
              <Send className="h-3.5 w-3.5" />
              发送
            </Button>
          </form>
        </div>
      )}

      {/* 2. Moments Tab Content */}
      {activeTab === 'moments' && (
        <div className="space-y-4">
          <div className="rounded-[4px_14px_4px_4px] bg-[#faf8f2] border border-[rgb(24_32_29/14%)] p-4 min-h-[360px] space-y-4">
            {posts.length === 0 ? (
              <div className="py-16 text-center text-xs text-[#68716d] space-y-2">
                <Share2 className="h-8 w-8 mx-auto text-stone-400 opacity-60" />
                <p>当前活动尚无朋友圈动态</p>
                <p className="text-[11px]">可使用下方发布新动态，或由 AI 根据群聊及发生事实生成。</p>
              </div>
            ) : (
              posts.map((post) => {
                const author = actorMap.get(post.authorActorId);
                const postComments = comments.filter((c) => c.postId === post.id);
                const postLikes = likes.filter((l) => l.postId === post.id);

                return (
                  <div
                    key={post.id}
                    className="p-4 rounded-[4px_12px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/12%)] space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded bg-stone-300 overflow-hidden flex items-center justify-center text-xs font-semibold text-stone-700">
                          {author?.appearanceReferenceAssetKeys?.[0] ? (
                            <Image
                              src={author.appearanceReferenceAssetKeys[0]}
                              alt={author.displayName}
                              width={36}
                              height={36}
                              className="object-cover h-full w-full"
                            />
                          ) : (
                            author?.displayName?.slice(0, 1) || '?'
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#18201d]">
                            {author?.displayName || post.authorActorId}
                          </div>
                          <div className="text-[10px] text-[#68716d]">动态作者</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeletePost(post.id)}
                        disabled={disabled}
                        className="text-stone-400 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="text-xs text-[#18201d] leading-relaxed whitespace-pre-wrap">
                      {post.text}
                    </p>

                    {/* Media slots */}
                    {post.mediaSlotIds && post.mediaSlotIds.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {post.mediaSlotIds.map((slotId) => (
                          <Badge key={slotId} variant="outline" className="text-[10px] bg-blue-50 text-blue-700">
                            🖼️ 动态配图槽位: {slotId}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Likes & Comments Section */}
                    <div className="pt-2 border-t border-[rgb(24_32_29/8%)] space-y-2">
                      <div className="flex items-center gap-2 text-xs text-[#68716d]">
                        <Heart className="h-3.5 w-3.5 text-rose-500 fill-rose-500" />
                        <span>点赞 ({postLikes.length} 人)：</span>
                        <div className="flex items-center gap-1">
                          {actors.map((act) => {
                            const isLiked = postLikes.some((l) => l.actorId === act.id);
                            return (
                              <button
                                key={act.id}
                                type="button"
                                onClick={() => handleToggleLike(post.id, act.id)}
                                disabled={disabled}
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                  isLiked
                                    ? 'bg-rose-100 text-rose-700 font-medium'
                                    : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                                }`}
                              >
                                {act.displayName}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Comments list */}
                      {postComments.length > 0 && (
                        <div className="bg-[#faf8f2] p-2.5 rounded text-xs space-y-1.5 border border-stone-200/60">
                          {postComments.map((comm) => {
                            const commAuthor = actorMap.get(comm.authorActorId);
                            return (
                              <div key={comm.id} className="text-xs">
                                <span className="font-semibold text-[#e45d35]">
                                  {commAuthor?.displayName || comm.authorActorId}:
                                </span>{' '}
                                <span className="text-[#18201d]">{comm.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Quick add comment */}
                      <div className="flex items-center gap-2 pt-1">
                        <Input
                          placeholder="添加对此动态的评论…"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const target = e.target as HTMLInputElement;
                              handleAddComment(post.id, actors[0]?.id || '', target.value);
                              target.value = '';
                            }
                          }}
                          disabled={disabled}
                          className="h-7 text-xs bg-transparent"
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Create Post Form */}
          <form
            onSubmit={handleCreatePost}
            className="p-3.5 rounded-[4px_12px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#18201d]">发布新动态</span>
              <div className="w-36">
                <Select
                  value={postAuthorId}
                  onChange={(e) => setPostAuthorId(e.target.value)}
                  disabled={disabled}
                  className="h-7 text-xs min-h-0"
                >
                  {actors.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.displayName}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <Textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="分享此刻的活动体验…"
              rows={2}
              disabled={disabled}
              className="text-xs bg-transparent resize-none"
            />

            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={disabled || !postText.trim()}
                className="h-7 px-3 text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                发布朋友圈
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* 3. Facts Tab Content */}
      {activeTab === 'facts' && (
        <div className="space-y-4">
          <div className="rounded-[4px_14px_4px_4px] bg-[#faf8f2] border border-[rgb(24_32_29/14%)] p-4 min-h-[300px] space-y-2.5">
            {facts.length === 0 ? (
              <div className="py-16 text-center text-xs text-[#68716d] space-y-2">
                <FileCheck className="h-8 w-8 mx-auto text-stone-400 opacity-60" />
                <p>当前活动尚无确定的阶段事实</p>
                <p className="text-[11px]">事实作为前序剧情的依据，供后续阶段或朋友圈引用。</p>
              </div>
            ) : (
              facts.map((fact) => (
                <div
                  key={fact.id}
                  className="flex items-center justify-between p-2.5 rounded bg-white border border-stone-200 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-medium text-[#18201d]">{fact.text}</div>
                    <div className="text-[10px] text-[#68716d]">
                      状态: {fact.status === 'happened' ? '已发生' : '预定事实'} | 知晓角色:{' '}
                      {(fact.knownByActorIds || []).map((id) => actorMap.get(id)?.displayName || id).join(', ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteFact(fact.id)}
                    disabled={disabled}
                    className="text-stone-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleAddFact} className="flex items-center gap-2">
            <Input
              value={factText}
              onChange={(e) => setFactText(e.target.value)}
              placeholder="记录本阶段确定的剧情事实（如：岚与澄在海边营地完成了晚餐合照）…"
              disabled={disabled}
              className="h-8 text-xs bg-[#fffdf8]"
            />
            <Button
              type="submit"
              size="sm"
              disabled={disabled || !factText.trim()}
              className="h-8 text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              添加事实
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
