import type { ProjectState } from './types'

/**
 * Brings saved project state up to date. State saved before several skills were allowed has a single
 * `skillId`; it becomes `skillIds`. Returns null for anything that isn't an object.
 */
export function migrateProjectState(raw: unknown): ProjectState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { skillId, ...rest } = raw as Partial<ProjectState> & { skillId?: unknown }
  const state = rest as ProjectState
  const list = Array.isArray(state.skillIds) ? state.skillIds : typeof skillId === 'string' && skillId ? [skillId] : []
  state.skillIds = [...new Set(list.filter((s): s is string => typeof s === 'string' && s !== ''))]
  return state
}
