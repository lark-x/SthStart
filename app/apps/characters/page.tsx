import type { Metadata } from 'next';
import { CharacterLibrary } from './character-library';

export const metadata: Metadata = { title: '角色资料库 — SthStart', description: '跨应用复用、可追溯版本的公共角色资料库。' };
export default function CharacterLibraryPage() { return <CharacterLibrary />; }
