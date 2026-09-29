'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function safeHref(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://sthstart.invalid');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch { return undefined; }
}

export function StoryMarkdown({ source }: { source: string }) {
  return <div className="story-markdown min-w-0 text-ink">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, children, ...props }) => {
        const safe = safeHref(href);
        return safe ? <a {...props} href={safe} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">{children}</a> : <span>{children}</span>;
      },
      img: ({ alt, src, ...props }) => {
        const safe = safeHref(typeof src === 'string' ? src : undefined);
        // Markdown images are user-authored content; next/image cannot optimize arbitrary external URLs here.
        // eslint-disable-next-line @next/next/no-img-element
        return safe ? <img {...props} src={safe} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" className="max-h-96 max-w-full rounded-[var(--radius-control)]" /> : <span className="text-xs text-muted">（不安全或无效的图片链接已隐藏）</span>;
      },
      h1: ({ children }) => <h1 className="mb-4 mt-7 text-3xl font-bold">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-3 mt-6 border-b border-border-subtle pb-2 text-2xl font-semibold">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-2 mt-5 text-xl font-semibold">{children}</h3>,
      p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
      ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
      ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
      blockquote: ({ children }) => <blockquote className="my-4 border-l-4 border-accent/40 pl-4 text-muted">{children}</blockquote>,
      pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-4 text-sm">{children}</pre>,
      code: ({ className, children, ...props }) => <code {...props} className={`${className ?? ''} rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.92em]`}>{children}</code>,
      table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
      th: ({ children }) => <th className="border border-border-default bg-surface-muted px-3 py-2 text-left">{children}</th>,
      td: ({ children }) => <td className="border border-border-default px-3 py-2 align-top">{children}</td>,
      hr: () => <hr className="my-6 border-border-default" />,
    }}>{source}</ReactMarkdown>
  </div>;
}
