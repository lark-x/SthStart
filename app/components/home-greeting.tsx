'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

function greetingFor(hour: number) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function readGreeting() {
  const now = new Date();
  const date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  return `${greetingFor(now.getHours())}|${date}`;
}

/** 首页问候：服务端渲染先给中性文案，水合后按本机时间替换，避免时区差导致的水合不一致。 */
export function HomeGreeting() {
  const value = useSyncExternalStore(subscribe, readGreeting, () => '');
  const [greeting, date] = value ? value.split('|') : ['', ''];

  return (
    <div className="min-w-0">
      <p className="home-greeting-date" data-visual-dynamic="true">{date || ' '}</p>
      <h1 className="home-greeting-title">
        <span className="sr-only">工作台</span>
        <span aria-hidden="true" data-visual-dynamic="true">{greeting ? `${greeting}，继续创作吧` : '工作台'}</span>
      </h1>
    </div>
  );
}
