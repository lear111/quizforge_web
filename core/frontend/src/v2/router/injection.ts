import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type { createWorkspaceNavigation } from './navigation';

export const workspaceNavigationKey: InjectionKey<ReturnType<typeof createWorkspaceNavigation>> =
  Symbol('workspace-navigation');
export const useWorkspaceNavigation = () => inject(workspaceNavigationKey)!;
