'use client';

import React, { useState } from 'react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { TaskStudio } from './task-studio';
import { WorkflowEditor } from './workflow-editor';
import { RoleSettings } from './role-settings';
import './creative-workbench.css';

export function CreativeWorkbench() {
  const [view, setView] = useState('tasks');
  const [opened, setOpened] = useState(new Set(['tasks']));
  const tabs = [
    { id: 'tasks', label: '对话与任务', panelId: 'creative-tasks' },
    { id: 'workflows', label: '创作流程', panelId: 'creative-workflows' },
    { id: 'roles', label: '岗位与模型', panelId: 'creative-roles' },
  ];
  return (
    <PageContainer className="co-workbench min-w-0 space-y-5">
      <PageHeader
        title="AI 创作工作台"
        description="组织创作岗位、编辑流程，并阅读和确认每一次创作的产物。"
        navigation={
          <PageTabs
            ariaLabel="AI 创作工作台视图"
            tabs={tabs}
            value={view}
            onChange={(next) => {
              setView(next);
              setOpened((previous) => new Set([...previous, next]));
            }}
          />
        }
      />
      <section id="creative-tasks" role="tabpanel" aria-label="对话与任务" hidden={view !== 'tasks'}>
        <TaskStudio />
      </section>
      <section id="creative-workflows" role="tabpanel" aria-label="创作流程" hidden={view !== 'workflows'}>
        {opened.has('workflows') && <WorkflowEditor />}
      </section>
      <section id="creative-roles" role="tabpanel" aria-label="岗位与模型" hidden={view !== 'roles'}>
        {opened.has('roles') && <RoleSettings />}
      </section>
    </PageContainer>
  );
}
