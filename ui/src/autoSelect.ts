export interface AutoSelectProject {
  id: string;
  cwd: string | null;
}

/**
 * Resolve which project should be auto-selected on launch.
 *
 * Priority: the server's --project-dir wins over a URL ?project= hint.
 * For each target, an exact cwd match wins over an endsWith fallback
 * (the fallback tolerates trailing-slash / nested-path differences).
 *
 * Returns null when no project matches yet — e.g. the launch-dir project
 * has not been ingested by the first scan. Callers must re-run this as the
 * project list grows so the correct project is selected once it appears.
 */
export function resolveAutoSelectId(
  projects: AutoSelectProject[],
  projectDir: string | null | undefined,
  urlProject: string | null | undefined,
): string | null {
  return matchProjectId(projects, projectDir) ?? matchProjectId(projects, urlProject);
}

function matchProjectId(
  projects: AutoSelectProject[],
  target: string | null | undefined,
): string | null {
  if (!target) return null;
  const exact = projects.find((project) => project.cwd === target);
  if (exact) return exact.id;
  const suffix = projects.find(
    (project) => project.cwd != null && project.cwd.endsWith(target),
  );
  return suffix?.id ?? null;
}
