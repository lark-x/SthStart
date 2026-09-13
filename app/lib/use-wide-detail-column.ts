'use client';

import { useSyncExternalStore } from 'react';

/*
 * 视口查询走 useSyncExternalStore：与 AppShell 的导航偏好同一模式，
 * 避免在 effect 里同步 setState（会触发级联渲染，且被 lint 规则判为错误）。
 */

function subscribe(query: string) {
  return (listener: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  };
}

function read(query: string) {
  return window.matchMedia(query).matches;
}

/**
 * 服务端一律按宽屏渲染：窄屏首帧不会先画出抽屉再消失，
 * 宽屏首帧也不会先闪一下抽屉。
 */
function serverValue() {
  return true;
}

/** 活动工作台「当前记录详情」辅助栏：≥1440px 内联，1280 及以下收起为抽屉（计划 §8.5）。 */
export function useWideDetailColumn() {
  return useSyncExternalStore(
    subscribe('(min-width: 1440px)'),
    () => read('(min-width: 1440px)'),
    serverValue
  );
}

/** 角色编辑器预览栏：≥1024px 内联右侧，小屏改用抽屉（计划 §8.3）。 */
export function useInlinePreviewColumn() {
  return useSyncExternalStore(
    subscribe('(min-width: 1024px)'),
    () => read('(min-width: 1024px)'),
    serverValue
  );
}

