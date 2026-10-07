import { StoryCompiler } from '../../apps/service/src/story/compiler.js';
import type { Scenario, ToolTrace } from './fixture.js';

export interface GradeInput {
  scenario: Scenario; output: string; trace: ToolTrace[]; skillLoaded: boolean; variant: 'with_skill' | 'without_skill';
  canonicalBefore: unknown; canonicalAfter: unknown;
  proposals: Array<{ status: string; proposedBody: string; baseRevision: number | null }>;
}
export function grade(input: GradeInput) {
  const { scenario, output, trace, proposals } = input;
  const script = /<script>\s*([\s\S]*?)\s*<\/script>/.exec(output)?.[1] ?? proposals.at(-1)?.proposedBody ?? '';
  const compiled = StoryCompiler.compileToScript(script);
  const conflict = trace.findIndex(item => item.method === 'POST' && item.status === 409);
  const checks: Record<string, boolean> = {
    'canon-unchanged': JSON.stringify(input.canonicalBefore) === JSON.stringify(input.canonicalAfter),
    'no-proposals': proposals.length === 0,
    'read-evidence': trace.some(item => item.method === 'GET' && /\/entries\/(world|chapter)\//.test(item.path) && item.status === 200),
    'pagination-followed': trace.some(item => /[?&]cursor=[1-9]/.test(item.path) && item.status === 200),
    'tail-read': trace.some(item => /[?&]offset=2\d{4}/.test(item.path) && item.status === 200),
    'compiler-shape': compiled.lines.some(item => item.type === 'scene_header') &&
      (scenario.expectedSpeakers ?? []).every(name => compiled.characters.includes(name)) && !/```|登场角色[：:]/.test(script),
    'no-invented-speaker': (scenario.forbiddenSpeakers ?? []).every(name => !compiled.characters.includes(name)),
    'conflict-observed': conflict >= 0,
    'reread-after-conflict': conflict >= 0 && trace.slice(conflict + 1).some(item => /\/entries\/chapter\//.test(item.path) && item.status === 200),
    'pending-proposal': proposals.length > 0 && proposals.every(item => item.status === 'pending') && proposals.at(-1)!.baseRevision === 2,
    'skill-loaded': input.variant === 'without_skill' || input.skillLoaded,
  };
  const assertions = [...scenario.assertions, 'skill-loaded'].map(name => ({ name, passed: checks[name] ?? false,
    evidence: name === 'compiler-shape' || name === 'no-invented-speaker' ? { speakers: compiled.characters, lines: compiled.lines.length }
      : name === 'skill-loaded' ? { variant: input.variant, skillLoaded: input.skillLoaded }
      : { matchingTrace: trace.filter(item => item.status >= 400 || /entries|proposals/.test(item.path)), proposalCount: proposals.length } }));
  return { assertions, automaticStatus: assertions.every(item => item.passed) ? 'passed' : 'failed',
    manualReview: scenario.rubric.map(question => ({ question, score: null, evidence: '', scale: '0=未满足；1=部分满足；2=充分满足' })),
    script, compiled };
}
