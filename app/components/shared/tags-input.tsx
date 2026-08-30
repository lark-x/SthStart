'use client';

import React, { useState } from 'react';

function parseTags(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

/**
 * 受控标签输入。value 是解析后的标签数组，输入框保留用户原始文本
 * （包括末尾的逗号），避免每次按键都重写受控值导致分隔符被吞、中文
 * IME 组合被打断。仅当外部 value 变化且不是本次输入的回显（水合、
 * 重置、AI 生成回填）时，才在渲染期重置输入框文本。
 */
export function TagsInput({
  value,
  onChange,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState(() => value.join('，'));
  const [snapshot, setSnapshot] = useState(() => ({
    valueSerialized: JSON.stringify(value),
    text: value.join('，'),
  }));

  const valueSerialized = JSON.stringify(value);
  if (snapshot.valueSerialized !== valueSerialized) {
    // 不是“文本解析结果恰好等于新 value”的回显时，视为外部重置。
    const echo = JSON.stringify(parseTags(text)) === valueSerialized;
    const nextText = echo ? text : value.join('，');
    setSnapshot({ valueSerialized, text: nextText });
    if (!echo) setText(nextText);
  }

  return (
    <input
      {...rest}
      className={className}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        onChange(parseTags(next));
      }}
    />
  );
}
