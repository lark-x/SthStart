import type {
  WorldActor,
  WorldLocation,
  WorldEvent,
  WorldImage,
  WorldBranch,
} from '@sthstart/contracts';
import type {
  ImagePhase,
  ImageStatus,
  SourceNature,
  BranchMode,
} from './types';

/**
 * Formats a world tick (minutes from simulation zero) into clean human-readable time.
 * Example: 0 -> "第 1 天 00:00", 480 -> "第 1 天 08:00", 1500 -> "第 2 天 01:00"
 */
export function formatTick(tick: number): string {
  const day = Math.floor(tick / 1440) + 1;
  const minuteInDay = tick % 1440;
  const hour = Math.floor(minuteInDay / 60);
  const minute = minuteInDay % 60;
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `第 ${day} 天 ${hh}:${mm}`;
}

/**
 * Concise tick format for small badges.
 * Example: "D1 08:00"
 */
export function formatShortTick(tick: number): string {
  const day = Math.floor(tick / 1440) + 1;
  const minuteInDay = tick % 1440;
  const hour = Math.floor(minuteInDay / 60);
  const minute = minuteInDay % 60;
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `D${day} ${hh}:${mm}`;
}

/**
 * Formats event duration in human-readable minutes or hours.
 * Returns empty string for zero/instantaneous durations to avoid clutter.
 */
export function formatDuration(durationTicks: number): string {
  if (durationTicks <= 0) return '';
  if (durationTicks < 60) return `${durationTicks} 分钟`;
  const hours = Math.floor(durationTicks / 60);
  const remainder = durationTicks % 60;
  return remainder > 0 ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

export const SOURCE_NATURE_CONFIG: Record<
  SourceNature,
  {
    label: string;
    description: string;
    badgeClass: string;
  }
> = {
  canon: {
    label: '原作有据',
    description: '经官方原作设定或已知设定核实的事实',
    badgeClass: 'bg-tone-green-soft text-tone-green-fg border-tone-green/30',
  },
  author: {
    label: '作者设定',
    description: '创作者主观制定的世界补充设定与规则',
    badgeClass: 'bg-tone-blue-soft text-tone-blue-fg border-tone-blue/30',
  },
  ai: {
    label: 'AI 创作',
    description: '由模拟系统推导演进生成的动态事件事实',
    badgeClass: 'bg-tone-orange-soft text-tone-orange-fg border-tone-orange/30',
  },
  unverified: {
    label: '待核实',
    description: '尚未对照原作或核心设定确认的待查内容',
    badgeClass: 'bg-tone-pink-soft text-tone-pink-fg border-tone-pink/30',
  },
};

export const BRANCH_MODE_CONFIG: Record<
  BranchMode,
  {
    label: string;
    subtitle: string;
    description: string;
    badgeClass: string;
  }
> = {
  'canon-gap': {
    label: '原作留白',
    subtitle: '同人留白补完',
    description: '严格遵循官方既定设定，在原作未详述的空白时段展开角色日常与行动',
    badgeClass: 'bg-tone-blue-soft text-tone-blue-fg border-tone-blue/30',
  },
  adaptation: {
    label: '原作改编',
    subtitle: '设定基底改编',
    description: '以原作角色与世界观为基底，对关键因果或情节走向进行主观微调与演绎',
    badgeClass: 'bg-tone-violet-soft text-tone-violet-fg border-tone-violet/30',
  },
  alternate: {
    label: '平行世界',
    subtitle: '全新平行宇宙',
    description: '改变核心前提条件或历史节点，推演完全独立自洽的平行宇宙走向',
    badgeClass: 'bg-tone-orange-soft text-tone-orange-fg border-tone-orange/30',
  },
};

export const IMAGE_PHASE_CONFIG: Record<
  ImagePhase,
  {
    label: string;
    stepOrder: number;
    description: string;
    subtleClass: string;
  }
> = {
  establishing: {
    label: '场景建立',
    stepOrder: 1,
    description: '交代空间环境、时间光影、氛围基调与角色站位',
    subtleClass: 'bg-tone-blue-soft text-tone-blue-fg border-tone-blue/30',
  },
  action: {
    label: '关键行动',
    stepOrder: 2,
    description: '刻画核心动作、角色言语互动、冲突转折或重要决策',
    subtleClass: 'bg-tone-orange-soft text-tone-orange-fg border-tone-orange/30',
  },
  result: {
    label: '结果变化',
    stepOrder: 3,
    description: '展现事态收尾、心理余波、关系改变与后续影响',
    subtleClass: 'bg-tone-green-soft text-tone-green-fg border-tone-green/30',
  },
};

export const IMAGE_STATUS_CONFIG: Record<
  ImageStatus,
  {
    label: string;
    description: string;
    variant: 'secondary' | 'warning' | 'running' | 'online' | 'error' | 'stopped';
  }
> = {
  planned: {
    label: '未生成',
    description: '分镜规划已建立，等待向生图队列提交',
    variant: 'secondary',
  },
  queued: {
    label: '排队中',
    description: '已提交生成任务，正在等待公共生图调度名额',
    variant: 'warning',
  },
  running: {
    label: '生成中',
    description: '生图引擎正在渲染画面',
    variant: 'running',
  },
  succeeded: {
    label: '已生成',
    description: '画面生成完毕，已成功关联到事件记录',
    variant: 'online',
  },
  failed: {
    label: '生成失败',
    description: '生成过程发生错误，不影响正文剧情继续阅读',
    variant: 'error',
  },
  uncertain: {
    label: '待核对',
    description: '外部调度连接异常或超时，状态等待系统复核',
    variant: 'warning',
  },
  stale: {
    label: '待重做',
    description: '事件设定或角色状态已发生调整，需按新设定重新排期',
    variant: 'stopped',
  },
};

export function lookupActor(actors: WorldActor[], actorId: string): WorldActor {
  const found = actors.find(a => a.id === actorId);
  if (found) return found;
  return {
    id: actorId,
    name: `角色 ${actorId.slice(0, 6)}`,
    role: 'supporting',
    characterId: null,
    characterVersion: null,
    background: '',
    personality: '',
    speechStyle: '',
    appearance: '',
    goals: [],
    locationId: '',
    referenceArtifactIds: [],
  };
}

export function lookupLocation(
  locations: WorldLocation[],
  locationId: string
): WorldLocation {
  const found = locations.find(loc => loc.id === locationId);
  if (found) return found;
  return {
    id: locationId,
    name: locationId ? `地点 ${locationId.slice(0, 6)}` : '未定场景',
    description: '',
  };
}

/**
 * Groups images by eventId.
 * If targetBranchId is specified, images from other branches are strictly rejected.
 */
export function groupImagesByEvent(
  images: WorldImage[] = [],
  targetBranchId?: string
): Map<string, WorldImage[]> {
  const map = new Map<string, WorldImage[]>();
  for (const img of images) {
    if (targetBranchId && img.branchId !== targetBranchId) {
      continue; // Strictly reject images from a mismatched branch
    }
    const list = map.get(img.eventId) || [];
    list.push(img);
    map.set(img.eventId, list);
  }
  return map;
}

/**
 * Groups images for a given set of events, strictly enforcing that each image's
 * branchId matches the target event's branchId. Mismatched images are rejected.
 */
export function groupImagesForEvents(
  images: WorldImage[] = [],
  events: WorldEvent[] = []
): Map<string, WorldImage[]> {
  const eventBranchMap = new Map<string, string>();
  for (const ev of events) {
    eventBranchMap.set(ev.id, ev.branchId);
  }

  const map = new Map<string, WorldImage[]>();
  for (const img of images) {
    const expectedBranchId = eventBranchMap.get(img.eventId);
    // If the image references an event in this set, verify branchId match
    if (expectedBranchId && img.branchId !== expectedBranchId) {
      continue; // Strictly reject mismatched branch image
    }
    const list = map.get(img.eventId) || [];
    list.push(img);
    map.set(img.eventId, list);
  }
  return map;
}

export function groupImagesByPhase(images: WorldImage[] = []): Record<ImagePhase, WorldImage[]> {
  const grouped: Record<ImagePhase, WorldImage[]> = {
    establishing: [],
    action: [],
    result: [],
  };
  for (const img of images) {
    if (img.phase in grouped) {
      grouped[img.phase].push(img);
    }
  }
  return grouped;
}

export function sortEventsChronologically(events: WorldEvent[] = []): WorldEvent[] {
  return [...events].sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
