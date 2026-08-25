import type { Metadata } from 'next';
import { NarrativeClient } from './narrative-client';

export const metadata: Metadata = { title: '叙事档案 — SthStart', description: '多作品剧情回顾、检索与证据化知识档案。' };
export default function NarrativePage() { return <NarrativeClient />; }
