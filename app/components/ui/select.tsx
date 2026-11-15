'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Input as MantineInput } from '@mantine/core';
import { useMergedRef } from '@mantine/hooks';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { mantineControlClasses } from './mantine-controls';
import { useFloatingOverlayRoot, useOverlayEscapeLayer } from './overlay-policy';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean | string;
}

interface SelectOptionItem {
  value: string;
  label: React.ReactNode;
  textLabel: string;
  disabled?: boolean;
}

type SelectEntry =
  | { kind: 'option'; item: SelectOptionItem }
  | { kind: 'group'; label: string; disabled?: boolean; items: SelectOptionItem[] };

interface DropdownPlacement {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Mantine 的 Input 样式对控件统一设置 `appearance: none`，原生下拉箭头随之消失，
 * 单行 select 看起来与文本输入框无法区分。这里用受支持的 `rightSection` 补回指示器：
 * 纯装饰（`aria-hidden`）、不接收指针事件，原生 select 的标签与禁用语义保持不变。
 */
const INDICATOR_SECTION_WIDTH = 28;
/**
 * 右侧内边距比指示器槽略宽，留出 4px 间隙：文字在箭头左侧收尾，短字段（h-8/h-9、
 * w-24）截断时也不会贴住箭头。
 */
const INDICATOR_INPUT_PADDING_END = INDICATOR_SECTION_WIDTH + 4 + 'px';

function extractTextContent(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractTextContent(node.props.children);
  }
  return '';
}

function parseSelectChildren(children: React.ReactNode): {
  entries: SelectEntry[];
  flatOptions: SelectOptionItem[];
} {
  const entries: SelectEntry[] = [];
  const flatOptions: SelectOptionItem[] = [];

  const toOptionItem = (
    props: React.OptionHTMLAttributes<HTMLOptionElement>,
  ): SelectOptionItem => {
    const textLabel = extractTextContent(props.children);
    const value = props.value !== undefined ? String(props.value) : textLabel;
    return {
      value,
      label: props.children ?? value,
      textLabel: textLabel || value,
      disabled: Boolean(props.disabled),
    };
  };

  const walk = (nodes: React.ReactNode, targetGroup?: SelectOptionItem[]) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement<Record<string, unknown>>(child)) return;

      if (child.type === React.Fragment) {
        walk(child.props.children as React.ReactNode, targetGroup);
        return;
      }

      if (child.type === 'option') {
        const item = toOptionItem(
          child.props as React.OptionHTMLAttributes<HTMLOptionElement>,
        );
        flatOptions.push(item);
        if (targetGroup) {
          targetGroup.push(item);
        } else {
          entries.push({ kind: 'option', item });
        }
        return;
      }

      if (child.type === 'optgroup') {
        const groupProps = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
        const items: SelectOptionItem[] = [];
        walk(groupProps.children, items);
        if (groupProps.disabled) {
          for (const item of items) item.disabled = true;
        }
        entries.push({
          kind: 'group',
          label: groupProps.label ?? '',
          disabled: Boolean(groupProps.disabled),
          items,
        });
        return;
      }

      if (child.props.children) {
        walk(child.props.children as React.ReactNode, targetGroup);
      }
    });
  };

  walk(children);
  return { entries, flatOptions };
}

function findNextEnabledIndex(
  options: SelectOptionItem[],
  startIndex: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;
  for (let step = 1; step <= options.length; step++) {
    const idx = (startIndex + step * direction + options.length) % options.length;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}

function findBoundaryEnabledIndex(
  options: SelectOptionItem[],
  fromEnd: boolean,
): number {
  if (fromEnd) {
    for (let i = options.length - 1; i >= 0; i--) {
      if (!options[i]?.disabled) return i;
    }
    return -1;
  }
  return options.findIndex((item) => !item.disabled);
}

function SelectIndicator({
  disabled,
  open,
}: {
  disabled?: boolean;
  open?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className={cn(
        'ui-select-indicator transition-transform duration-150',
        open ? 'rotate-180 text-ink' : undefined,
      )}
      style={disabled ? { opacity: 'var(--control-disabled-opacity, 0.6)' } : undefined}
    >
      <path
        d="M3.5 6L8 10.5L12.5 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function computeDropdownPlacement(
  selectEl: Pick<HTMLSelectElement, 'getBoundingClientRect'>,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): DropdownPlacement {
  const rect = selectEl.getBoundingClientRect();
  const viewportW = viewport.width;
  const viewportH = viewport.height;
  const margin = 8;
  const gap = 4;
  const spaceBelow = viewportH - rect.bottom - margin - gap;
  const spaceAbove = rect.top - margin - gap;
  const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
  const availableHeight = Math.max(0, placeAbove ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(280, availableHeight);
  const maxWidth = Math.max(0, viewportW - margin * 2);
  const minWidth = Math.min(maxWidth, Math.max(rect.width, 132));
  const left = Math.min(Math.max(rect.left, margin), Math.max(margin, viewportW - margin - minWidth));

  return placeAbove
    ? {
        bottom: Math.max(margin, viewportH - rect.top + gap),
        left,
        minWidth,
        maxWidth,
        maxHeight,
      }
    : {
        top: Math.min(viewportH - margin, rect.bottom + gap),
        left,
        minWidth,
        maxWidth,
        maxHeight,
      };
}

/** 与 Button/Input 同规范：统一点击高度、圆角与错误态；单选下拉展开为统一浮层菜单。 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      error,
      children,
      size,
      style,
      multiple,
      disabled,
      onMouseDown,
      onKeyDown,
      onChange,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const invalid = Boolean(error) || Boolean(ariaInvalid) || undefined;
    // 多选或 size>1 会渲染成列表框，箭头没有意义，也会挤占选项区域。
    const listbox = Boolean(multiple) || (typeof size === 'number' && size > 1);
    const withIndicator = !listbox;

    const selectRef = useRef<HTMLSelectElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const mergedRef = useMergedRef(selectRef, ref);

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [placement, setPlacement] = useState<DropdownPlacement | null>(null);
    const [domOptions, setDomOptions] = useState<SelectOptionItem[] | null>(null);
    const [currentDomValue, setCurrentDomValue] = useState<string>(() => {
      if (props.value !== undefined) return String(props.value);
      if (props.defaultValue !== undefined) return String(props.defaultValue);
      return '';
    });

    const parsed = useMemo(() => parseSelectChildren(children), [children]);

    const resolveEffectiveOptions = useCallback((): {
      entries: SelectEntry[];
      flatOptions: SelectOptionItem[];
    } => {
      if (parsed.flatOptions.length > 0 || !selectRef.current) {
        return parsed;
      }
      const domOptions: SelectOptionItem[] = Array.from(selectRef.current.options).map((opt) => ({
        value: opt.value,
        label: opt.text,
        textLabel: opt.text,
        disabled: opt.disabled,
      }));
      return {
        entries: domOptions.map((item) => ({ kind: 'option' as const, item })),
        flatOptions: domOptions,
      };
    }, [parsed]);

    const activeValue = props.value !== undefined ? String(props.value) : currentDomValue;

    const closeDropdownWithFocus = useCallback(() => {
      setOpen(false);
      selectRef.current?.focus({ preventScroll: true });
    }, []);

    const portalTarget = useFloatingOverlayRoot(open && withIndicator);

    useOverlayEscapeLayer(open && withIndicator, closeDropdownWithFocus, 'popover');

    const openDropdown = useCallback(() => {
      if (!withIndicator || disabled || !selectRef.current) return;
      const selectEl = selectRef.current;
      const liveValue = props.value !== undefined ? String(props.value) : selectEl.value;
      setCurrentDomValue(liveValue);
      const { flatOptions } = resolveEffectiveOptions();
      if (parsed.flatOptions.length === 0 && flatOptions.length > 0) {
        setDomOptions(flatOptions);
      }
      const selectedIdx = flatOptions.findIndex((opt) => opt.value === liveValue && !opt.disabled);
      const fallbackIdx = findBoundaryEnabledIndex(flatOptions, false);
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : fallbackIdx);
      setPlacement(computeDropdownPlacement(selectEl));
      setOpen(true);
    }, [disabled, parsed.flatOptions.length, props.value, resolveEffectiveOptions, withIndicator]);

    const commitOptionValue = useCallback(
      (nextValue: string) => {
        const selectEl = selectRef.current;
        if (selectEl) {
          if (selectEl.value !== nextValue) {
            const descriptor = Object.getOwnPropertyDescriptor(
              window.HTMLSelectElement.prototype,
              'value',
            );
            descriptor?.set?.call(selectEl, nextValue);
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          selectEl.focus({ preventScroll: true });
        }
        setCurrentDomValue(nextValue);
        setOpen(false);
      },
      [],
    );

    // Sync uncontrolled DOM selection after mount or external value updates.
    useEffect(() => {
      if (!open || !selectRef.current) return;
      setCurrentDomValue(props.value !== undefined ? String(props.value) : selectRef.current.value);
    }, [open, props.value]);

    // Reposition on resize/scroll and close on outside pointer or focus leave.
    useLayoutEffect(() => {
      if (!open || !withIndicator || !selectRef.current) return;

      const updatePosition = () => {
        if (!selectRef.current) return;
        const rect = selectRef.current.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          setOpen(false);
          return;
        }
        setPlacement(computeDropdownPlacement(selectRef.current));
      };

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (
          target &&
          (selectRef.current?.contains(target) || dropdownRef.current?.contains(target))
        ) {
          return;
        }
        setOpen(false);
      };

      const handleFocusIn = (event: FocusEvent) => {
        const target = event.target as Node | null;
        if (
          target &&
          (selectRef.current?.contains(target) || dropdownRef.current?.contains(target))
        ) {
          return;
        }
        setOpen(false);
      };

      const handleScroll = (event: Event) => {
        const target = event.target as Node | null;
        if (target && dropdownRef.current?.contains(target)) return;
        updatePosition();
      };

      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', handleScroll, true);
      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('focusin', handleFocusIn);

      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('pointerdown', handlePointerDown);
        document.removeEventListener('focusin', handleFocusIn);
      };
    }, [open, withIndicator]);

    // Keep the active item visible when opening or navigating via keyboard.
    useEffect(() => {
      if (!open || activeIndex < 0) return;
      const node = dropdownRef.current?.querySelector<HTMLElement>(
        `[data-option-index="${activeIndex}"]`,
      );
      node?.scrollIntoView({ block: 'nearest' });
    }, [open, activeIndex]);

    const handleMouseDown = (event: React.MouseEvent<HTMLSelectElement>) => {
      onMouseDown?.(event);
      if (event.defaultPrevented || !withIndicator || disabled || event.button !== 0) {
        return;
      }
      // Suppress OS native <select> popup and render SthStart's custom menu instead.
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      if (open) {
        setOpen(false);
      } else {
        openDropdown();
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLSelectElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !withIndicator || disabled) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;

      const { flatOptions } = resolveEffectiveOptions();

      if (!open) {
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === ' ' ||
          event.key === 'Enter'
        ) {
          event.preventDefault();
          openDropdown();
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => findNextEnabledIndex(flatOptions, prev < 0 ? -1 : prev, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) =>
          findNextEnabledIndex(flatOptions, prev < 0 ? 0 : prev, -1),
        );
      } else if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(findBoundaryEnabledIndex(flatOptions, false));
      } else if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(findBoundaryEnabledIndex(flatOptions, true));
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const activeOption = flatOptions[activeIndex];
        if (activeOption && !activeOption.disabled) {
          commitOptionValue(activeOption.value);
        } else {
          setOpen(false);
        }
      } else if (event.key === 'Tab') {
        setOpen(false);
      }
    };

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      setCurrentDomValue(event.currentTarget.value);
      onChange?.(event);
    };

    const effectiveEntries: SelectEntry[] =
      parsed.entries.length === 0 && domOptions?.length
        ? domOptions.map((item) => ({ kind: 'option', item }))
        : parsed.entries;
    let optionRenderIndex = 0;

    return (
      <>
        <MantineInput
          component="select"
          ref={mergedRef}
          multiple={multiple}
          disabled={disabled}
          error={error || (ariaInvalid ? true : undefined)}
          inputSize={size !== undefined ? String(size) : undefined}
          classNames={{
            wrapper: mantineControlClasses.inputWrapper,
            input: cn('ui-control', className),
          }}
          rightSection={
            withIndicator ? <SelectIndicator disabled={disabled} open={open} /> : undefined
          }
          rightSectionWidth={withIndicator ? INDICATOR_SECTION_WIDTH : undefined}
          rightSectionPointerEvents="none"
          rightSectionProps={withIndicator ? { 'aria-hidden': true } : undefined}
          wrapperProps={{ 'data-ui-select-indicator': withIndicator ? 'true' : undefined }}
          styles={{
            input: {
              // appearance 与 Mantine 的 Input 样式一致；显式声明可避免在样式表缺失时
              // 出现“原生箭头 + 自绘箭头”两个指示器。
              ...(withIndicator
                ? {
                    appearance: 'none' as const,
                    overflow: 'clip',
                    paddingInlineEnd: INDICATOR_INPUT_PADDING_END,
                  }
                : null),
              ...style,
            },
          }}
          withAria
          attributes={
            ariaDescribedBy !== undefined || invalid
              ? {
                  input: {
                    ...(ariaDescribedBy !== undefined ? { 'aria-describedby': ariaDescribedBy } : {}),
                    ...(invalid ? { 'aria-invalid': true } : {}),
                  },
                }
              : undefined
          }
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          {...props}
        >
          {children}
        </MantineInput>

        {open && withIndicator && placement && portalTarget
          ? createPortal(
              <div
                ref={dropdownRef}
                role="listbox"
                data-popover-dropdown="true"
                data-sthstart-layer="true"
                data-ui-select-dropdown="true"
                data-autohide-scroll="true"
                style={{
                  position: 'fixed',
                  top: placement.top,
                  bottom: placement.bottom,
                  left: placement.left,
                  minWidth: placement.minWidth,
                  maxWidth: placement.maxWidth,
                  maxHeight: placement.maxHeight,
                  zIndex: 400,
                  boxShadow: 'var(--elev-lg), 0 0 0 1px var(--border-subtle)',
                }}
                className="overflow-x-hidden overflow-y-auto rounded-[var(--radius-panel)] bg-surface-raised p-1.5 text-ink animate-in fade-in zoom-in-95 duration-150"
              >
                {effectiveEntries.map((entry, entryIdx) => {
                  if (entry.kind === 'group') {
                    return (
                      <div key={`group-${entryIdx}`} role="group" aria-label={entry.label} className="py-0.5">
                        {entry.label && (
                          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase select-none">
                            {entry.label}
                          </div>
                        )}
                        {entry.items.map((item) => {
                          const idx = optionRenderIndex++;
                          const isSelected = item.value === activeValue;
                          const isActive = idx === activeIndex;
                          return (
                            <button
                              key={`${item.value}-${idx}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              disabled={item.disabled}
                              data-option-index={idx}
                              data-active={isActive ? 'true' : undefined}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => {
                                if (!item.disabled) setActiveIndex(idx);
                              }}
                              onClick={() => {
                                if (!item.disabled) commitOptionValue(item.value);
                              }}
                              className={cn(
                                'flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors select-none',
                                item.disabled
                                  ? 'cursor-not-allowed opacity-45'
                                  : isSelected
                                    ? 'bg-[var(--selection-bg)] font-semibold text-[var(--selection-fg)]'
                                    : isActive
                                      ? 'bg-surface-hover text-ink'
                                      : 'text-ink/90 hover:bg-surface-hover hover:text-ink',
                              )}
                            >
                              <span className="min-w-0 wrap-anywhere">{item.label}</span>
                              {isSelected && (
                                <Check
                                  className="size-3.5 shrink-0 text-accent-dark"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  }

                  const item = entry.item;
                  const idx = optionRenderIndex++;
                  const isSelected = item.value === activeValue;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={`${item.value}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={item.disabled}
                      data-option-index={idx}
                      data-active={isActive ? 'true' : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => {
                        if (!item.disabled) setActiveIndex(idx);
                      }}
                      onClick={() => {
                        if (!item.disabled) commitOptionValue(item.value);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors select-none',
                        item.disabled
                          ? 'cursor-not-allowed opacity-45'
                          : isSelected
                            ? 'bg-[var(--selection-bg)] font-semibold text-[var(--selection-fg)]'
                            : isActive
                              ? 'bg-surface-hover text-ink'
                              : 'text-ink/90 hover:bg-surface-hover hover:text-ink',
                      )}
                    >
                      <span className="min-w-0 wrap-anywhere">{item.label}</span>
                      {isSelected && (
                        <Check
                          className="size-3.5 shrink-0 text-accent-dark"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>,
              portalTarget,
            )
          : null}
      </>
    );
  },
);

Select.displayName = 'Select';
