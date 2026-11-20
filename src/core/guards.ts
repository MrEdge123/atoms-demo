import type { Project } from '../domain';

/**
 * Pure workflow gate predicates shared between the workflow engine, API routes,
 * and client Workbench UI without pulling server-only dependencies.
 */
export function isPlanningInProgress(project: Pick<Project, 'status'>): boolean {
  return project.status === 'researching' || project.status === 'planning';
}

export function isPendingPlanConfirmation(
  project: Pick<Project, 'status'>
): boolean {
  return (
    project.status === 'researching' ||
    project.status === 'planning' ||
    project.status === 'awaiting_confirmation'
  );
}

export function isBuildingInProgress(project: Pick<Project, 'status'>): boolean {
  return project.status === 'building';
}

export function hasPendingRaceSelection(
  project: Pick<Project, 'status' | 'raceBranches'>
): boolean {
  return (
    project.raceBranches.length > 0 ||
    project.status === 'awaiting_branch_selection'
  );
}

export function getMutationBlockReason(
  project: Pick<Project, 'status' | 'raceBranches'>,
  action: 'iterate' | 'publish'
): string | null {
  if (isPlanningInProgress(project)) {
    return action === 'publish'
      ? 'Iris / Emma 正在生成新产品方案，请等待方案就绪并确认构建后再发布'
      : 'Iris / Emma 正在生成新产品方案，请等待方案就绪并确认构建后再进行迭代修改';
  }

  if (project.status === 'awaiting_confirmation') {
    return action === 'publish'
      ? '当前存在待确认的 Emma 产品方案，请先确认方案并让 Alex 完成构建后再发布'
      : '当前存在待确认的 Emma 产品方案，请先确认方案并让 Alex 完成构建后再进行迭代修改';
  }

  if (isBuildingInProgress(project)) {
    return action === 'publish'
      ? 'Alex 正在构建当前方案，请等待构建完成后再发布'
      : 'Alex 正在构建当前方案，请等待构建完成后再进行迭代修改';
  }

  if (hasPendingRaceSelection(project)) {
    return action === 'publish'
      ? '请先在 Race Mode 候选方案中选择并采用一个可用方案，再执行发布'
      : '请先在 Race Mode 候选方案中选择并采用一个可用方案，再继续迭代修改';
  }

  return null;
}
