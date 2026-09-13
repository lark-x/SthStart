'use client';

import { useEffect } from 'react';

/**
 * 滚动条自动隐藏：滚动时才显示滑块，停手约 800ms 后隐去。
 *
 * 为什么不逐个容器绑事件：应用里可滚动的地方很多（页面本身、侧栏、抽屉、
 * 双栏工作区、弹层、各类列表），逐个接管既容易漏、又会随页面增删失效。
 * 这里在 document 上用捕获阶段挂**一个**监听——`scroll` 事件不冒泡，
 * 但捕获阶段仍会经过祖先，所以这一处就能收到所有后代的滚动。
 *
 * 只给「正在滚动的那个元素」打标记，而不是给根元素打：否则一个面板滚动
 * 会让所有溢出容器的滑块一起冒出来。
 *
 * 具体显隐样式在 shell.css；本组件只负责标记，不接管颜色与宽度。
 */
const IDLE_MS = 800;

export function AutoHideScrollbars() {
  useEffect(() => {
    let timer = 0;
    let marked: Element | null = null;

    const unmark = () => {
      marked?.removeAttribute('data-scrolling');
      marked = null;
    };

    const onScroll = (event: Event) => {
      // 视口滚动的 target 是 document，标记在根元素上才能命中 CSS 规则。
      const target = event.target === document ? document.documentElement : event.target;
      if (!(target instanceof Element)) return;

      if (marked !== target) unmark();
      marked = target;
      target.setAttribute('data-scrolling', '');

      window.clearTimeout(timer);
      timer = window.setTimeout(unmark, IDLE_MS);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.clearTimeout(timer);
      unmark();
    };
  }, []);

  return null;
}

export default AutoHideScrollbars;
