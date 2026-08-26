import { CharacterEditor } from '../character-editor';
export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <CharacterEditor characterId={id}/>; }
