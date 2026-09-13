import type { Metadata } from 'next';
import { CalendarView } from '@/app/features/calendar/calendar-view';

export const metadata: Metadata = { title: '角色日历 — SthStart', description: '查看角色生日与已排期活动，并从生日直接创建活动。' };
export default function CalendarPage() { return <CalendarView />; }
