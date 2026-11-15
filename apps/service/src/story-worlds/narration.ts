/** Prose policy only; factual and information boundaries stay in simulation/runtime. */
export const WORLD_NARRATION_REVIEW_TASK = '对照当前人物可知的事件facts审查正文；ownIntent只是打算，不能证明未裁定的动作或心情已发生。检查新增动作、结果、承诺、对白含义、他人内心或未知信息，逐条指出eventId及具体越界内容。不可用未提供的全局历史补足正文，也不猜测未提供的秘密或原作。只对事实/视角实质问题拒绝，不因等义对白、自然语序或省略不影响当前结果的排程、未变化旁项而拒绝。保留确有意义的拒绝与不确定性；不能将未知营业情况改成可靠推荐。纯睡眠不能用第一人称自我观察或精确报时。只返回approved和issues；有实质问题时approved=false，否则approved=true、issues=[]。';

/** Legacy reviews may have seen global secrets. Never forward their details. */
export function narrationCorrectionIssues(issues: string[], samePersonalInput: boolean): string {
  if (!samePersonalInput) return '叙事审查未通过。历史审查使用了不同的资料范围，不能转述其中详情；仅按本人可知事实修正，不得补造事实。';
  const detail = issues.slice(0, 8).join('; ').slice(0, 6000);
  return '叙事审查未通过，请只依据本视角事实修正。具体问题：' + (detail || '审查拒绝但未提供具体说明，不得补造事实。');
}
export const WORLD_NARRATION_TASK = "逐个事件写当前人物的有限视角，只以提供的facts和所引factIds为已发生事实依据。先找本事件实际发生的一个动作、关键回应或结果作为叙述中心；围绕actor.personality和speechStyle选择关注点与句子节奏，不把全部事实依次改写成值班记录，也不用固定口癖代替个性。ownIntent只表明本人打算，未获裁定的动作、心理和感官体验不能当成事实。 简单休息写实际的休息即可；“预备的休息尚未完成、到本步结束、没有重开某项工作、清单仍在原处”等排程、边界或未变化的旁项，若不影响理解当前结果则省略，不写成段尾汇报。不为凑篇幅重新列出已经停下的工作。保留会改变读者理解的拒绝、不确定性和限制，例如不知道哪里有空房不能改成确定推荐，尚未选定去处不能写成已经出发。省略某事实不等于否定它。 已记载的提问与回应可写成等义对白，突出本人物在意的一句或一个结果，其余简要带过；不得新增承诺、对白含义、他人内心或未知秘密。允许第一人称和围绕本人的有限第三人称；纯睡眠、无意识时段只用一句简短第三人称概述，不让睡着的人自我观察、报时或汇报尚未醒来。精确tick、分钟数和时段留给时间轴，只有已记录的对话或时间判断需要时才写出。 步行、用餐、休息可以很短，不强行渲染氛围；不得增加facts未支持的天气、香气、目光、身体动作、心情变化、内心独白或往事。已有动作和言语可以自然组织，事实不能改变。性别不明时使用姓名或你我。只返回passages。";
