'use client';

import React, {
  Component,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Button } from '@/app/components/ui/button';

/** Keep the loader at module scope. Browsers cache a rejected import URL, so a
 * retry needs a fresh URL for the failed same-origin production entry chunk. */
export function createRetryableLoader<M, P extends object>(
  load: () => Promise<M>,
  select: (module: M) => { default: ComponentType<P> },
) {
  let failedUrl: string | null = null;
  let attempt = 0;
  return async () => {
    try {
      if (failedUrl) {
        const url = new URL(failedUrl);
        url.searchParams.set('panelRetry', String(++attempt));
        return select(await import(/* @vite-ignore */ url.href) as M);
      }
      return select(await load());
    } catch (error) {
      if (typeof window !== 'undefined' && error instanceof Error) {
        const candidate = error.message.split(' ').find(part => part.startsWith(window.location.origin + '/_next/static/chunks/'));
        if (candidate) {
          const url = new URL(candidate);
          if (url.pathname.endsWith('.js')) failedUrl = url.href;
        }
      }
      throw error;
    }
  };
}

export interface LazyLoadingStatusProps {
  label?: string;
  message?: string;
  className?: string;
}

/**
 * 通用无业务依赖的懒加载中状态展示
 */
export function LazyLoadingStatus({
  label,
  message,
  className,
}: LazyLoadingStatusProps) {
  const text = message || (label ? `正在加载${label}…` : '正在载入内容…');
  return (
    <div
      role="status"
      className={
        className ||
        'flex h-full min-h-0 w-full items-center justify-center gap-2 p-6 text-sm text-muted'
      }
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
      <span>{text}</span>
    </div>
  );
}

export interface LazyErrorAlertProps {
  label?: string;
  error?: Error | null;
  message?: string;
  onRetry: () => void;
  className?: string;
}

/**
 * 通用无业务依赖的懒加载失败提示与重试组件
 */
export function LazyErrorAlert({
  label,
  error,
  message,
  onRetry,
  className,
}: LazyErrorAlertProps) {
  const fallbackMsg = message || (label ? `无法加载${label}。` : '内容加载失败。');
  const detail = error?.message ? `（${error.message}）` : '';

  return (
    <div
      role="alert"
      className={
        className ||
        'flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink'
      }
    >
      <p className="text-danger-fg font-medium">
        {fallbackMsg}
        {detail}
      </p>
      <p className="text-xs text-muted">请重试加载此面板，无需刷新整页。</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        重新加载
      </Button>
    </div>
  );
}

export interface LazyPanelErrorBoundaryProps {
  label?: string;
  onRetry?: () => void;
  errorFallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  children: ReactNode;
}

interface LazyPanelErrorBoundaryState {
  error: Error | null;
}

/**
 * 面板渲染错误的通用可恢复 ErrorBoundary
 */
export class LazyPanelErrorBoundary extends Component<
  LazyPanelErrorBoundaryProps,
  LazyPanelErrorBoundaryState
> {
  override state: LazyPanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LazyPanelErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[LazyPanel] 加载组件失败:', error, errorInfo);
    }
  }

  reset = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (error) {
      const { errorFallback, label } = this.props;
      if (typeof errorFallback === 'function') {
        return errorFallback(error, this.reset);
      }
      if (errorFallback) {
        return errorFallback;
      }
      return <LazyErrorAlert label={label} error={error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

export interface LazyPanelProps<P extends object = Record<string, unknown>> {
  /** 面板名称，用于默认可访问标签及失败说明 */
  label?: string;
  /** 动态 import 加载函数，例如 () => import('./my-component').then(m => ({ default: m.MyComponent })) */
  loader: () => Promise<{ default: ComponentType<P> }>;
  /** 传递给目标懒加载组件的属性 */
  componentProps?: P;
  /** 传递给目标懒加载组件的子节点 */
  children?: ReactNode;
  /** 自定义加载中组件，缺省为 LazyLoadingStatus */
  fallback?: ReactNode;
  /** 自定义失败状态，支持 ReactNode 或渲染函数 (error, retry) => ReactNode */
  errorFallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  /** 重试时的额外回调 */
  onRetry?: () => void;
  /** 外层容器类名，缺省为 h-full min-h-0 w-full */
  className?: string;
}

/**
 * 按需加载面板；模块就绪后立即显示，避免嵌套 Suspense 的回退最小展示时间叠加。
 * 重试只重建面板，上层持有需要跨面板保留的编辑会话。
 */
export function LazyPanel<P extends object = Record<string, unknown>>({
  label,
  loader,
  componentProps,
  children,
  fallback,
  errorFallback,
  onRetry,
  className,
}: LazyPanelProps<P>) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    loader: LazyPanelProps<P>['loader']; attempt: number;
    component?: ComponentType<P>; error?: Error;
  } | null>(null);

  const handleRetry = useCallback(() => {
    onRetry?.();
    setAttempt((v) => v + 1);
  }, [onRetry]);

  useEffect(() => {
    let active = true;
    void loader().then(
      module => { if (active) setLoaded({ loader, attempt, component: module.default }); },
      reason => { if (active) setLoaded({ loader, attempt, error: reason instanceof Error ? reason : new Error(String(reason)) }); },
    );
    return () => { active = false; };
  }, [loader, attempt]);

  const current = loaded?.loader === loader && loaded.attempt === attempt ? loaded : null;
  const LoadedComponent = current?.component;

  const props = (componentProps || {}) as P;

  return (
    <div className={className ?? 'h-full min-h-0 w-full'}>
      <LazyPanelErrorBoundary
        key={attempt}
        label={label}
        onRetry={handleRetry}
        errorFallback={errorFallback}
      >
        {current?.error
          ? (typeof errorFallback === 'function'
            ? errorFallback(current.error, handleRetry)
            : errorFallback ?? <LazyErrorAlert label={label} error={current.error} onRetry={handleRetry} />)
          : LoadedComponent
            ? <LoadedComponent {...props}>{children}</LoadedComponent>
            : fallback ?? <LazyLoadingStatus label={label} />}
      </LazyPanelErrorBoundary>
    </div>
  );
}
