import type { CharacterBrowseQuery } from '@sthstart/contracts';

export interface CharacterFilterChip {
  key: string;
  label: string;
  clear: () => CharacterBrowseQuery;
}

/** 把当前筛选条件翻译成可逐个移除的标签；纯函数，不依赖 React 或路由。 */
export function activeCharacterFilterChips(filter: CharacterBrowseQuery): CharacterFilterChip[] {
  const chips: CharacterFilterChip[] = [];
  for (const [key, label] of [['works', '作品'], ['tags', '标签'], ['groups', '分组']] as const) {
    for (const value of filter[key] || []) {
      chips.push({ key: `${key}:${value}`, label: `${label}：${value}`, clear: () => ({ [key]: (filter[key] || []).filter((item) => item !== value) }) });
    }
  }
  if (filter.tags?.length && filter.tagMode === 'all') chips.push({ key: 'tagMode', label: '标签：全部匹配', clear: () => ({ tagMode: undefined }) });
  if (filter.q) chips.push({ key: 'q', label: `搜索：${filter.q}`, clear: () => ({ q: '' }) });
  if (filter.favorite) chips.push({ key: 'favorite', label: '仅收藏', clear: () => ({ favorite: undefined }) });
  const selects: Array<[keyof CharacterBrowseQuery, string, (value: string) => string]> = [
    ['mediaType', '作品类型', (value) => value],
    ['originType', '创作类型', (value) => (value === 'ip' ? '原作 IP' : value === 'derivative' ? '同人衍生' : '原创')],
    ['workNature', '作品属性', (value) => (value === 'canon' ? '原作' : value === 'derivative' ? '同人' : '原创')],
    ['parentWork', '母原作', (value) => value],
    ['reference', '外观参考图', (value) => (value === 'yes' ? '有可用参考图' : '无可用参考图')],
    ['appearance', '外观描述', (value) => (value === 'yes' ? '已填写外观' : '未填写外观')],
    ['interpretation', '人设演绎', (value) => value],
    ['source', '导入来源', (value) => (value === 'local' ? '本地角色卡' : value === 'manual' ? '手动创建' : value)],
    ['unclassified', '待整理', (value) => (value === 'work' ? '未设置作品' : '未设置标签')],
    ['birthdayStatus', '生日', (value) => (value === 'known' ? '生日已知' : value === 'needs_confirmation' ? '生日待确认' : '未填写生日')],
    ['birthdayMonth', '生日月份', (value) => `${value} 月生日`],
  ];
  for (const [key, label, format] of selects) {
    const value = filter[key];
    if (value === undefined || value === null || value === '') continue;
    chips.push({ key: `${String(key)}`, label: `${label}：${format(String(value))}`, clear: () => ({ [key]: undefined }) });
  }
  return chips;
}

export function hasCharacterFilters(filter: CharacterBrowseQuery): boolean {
  return activeCharacterFilterChips(filter).length > 0;
}
