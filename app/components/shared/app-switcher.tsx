'use client';
import { usePathname, useRouter } from 'next/navigation';
import { Select } from '../ui/select';
const apps = [
  ['/', '门户'], ['/apps/activities', '活动工作室'], ['/apps/creative', '创作中心'],
  ['/apps/characters', '角色资料库'], ['/apps/notebook', '创作笔记'], ['/apps/narrative', '叙事档案'],
  ['/settings/control-center', '控制中心'], ['/settings/public-services', '公共服务'], ['/settings/generation', '生成配置'],
];
export function AppSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const selected = apps.find(([path]) => path !== '/' && pathname.startsWith(path))?.[0] ?? '/';
  return <Select aria-label="切换应用" value={selected} onChange={(event) => router.push(event.target.value)} className="max-w-40 text-sm">
    {apps.map(([path, title]) => <option key={path} value={path}>{title}</option>)}
  </Select>;
}
