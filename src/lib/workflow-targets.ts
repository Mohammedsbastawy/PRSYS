// Step-target resolution shared by the request/approval APIs.
// Pure logic + data callbacks (no prisma import, so clients can use describeStepTarget too).

export interface StepTargetInput {
  ApproverType: string;
  TargetUserID: string | null;
  TargetGroupID: string | null;
  TargetRoleID: string | null;
  TargetUser?: { Name: string } | null;
  TargetGroup?: { Name: string } | null;
  TargetRole?: { Name: string } | null;
}

export interface StepLookups {
  usersWithRole: (roleId: string) => Promise<string[]>;
  groupMembers: (groupId: string) => Promise<string[]>;
  requesterManager: (requesterId: string) => Promise<string | null>;
  /** Resolves the MANAGER of the requester's department (an assignment, not a role) */
  departmentManager: (requesterId: string) => Promise<string | null>;
  allApprovers: () => Promise<string[]>;
}

export function describeStepTarget(step: StepTargetInput): string {
  switch (step.ApproverType) {
    case "ROLE":
      return step.TargetRole?.Name ? `Role: ${step.TargetRole.Name}` : "The assigned role";
    case "GROUP":
      return step.TargetGroup?.Name ? `Group: ${step.TargetGroup.Name}` : "The assigned group";
    case "USER":
      return step.TargetUser?.Name ?? "The assigned user";
    case "REQUESTER_MANAGER":
      return "Requester's direct manager";
    case "DEPARTMENT_MANAGER":
      return "Requester's department manager";
    case "ANY_APPROVER":
    default:
      return "Any approver";
  }
}

export async function stepTargetUserIds(
  step: StepTargetInput,
  requesterId: string,
  lookups: StepLookups
): Promise<string[]> {
  switch (step.ApproverType) {
    case "USER":
      return step.TargetUserID ? [step.TargetUserID] : [];
    case "ROLE":
      return step.TargetRoleID ? lookups.usersWithRole(step.TargetRoleID) : [];
    case "GROUP":
      return step.TargetGroupID ? lookups.groupMembers(step.TargetGroupID) : [];
    case "REQUESTER_MANAGER": {
      const m = await lookups.requesterManager(requesterId);
      return m ? [m] : [];
    }
    case "DEPARTMENT_MANAGER": {
      // Department manager is an ASSIGNMENT (DEP.ManagerID), not a role —
      // any Self User can manage a department and still keep the self-service UX.
      const m = await lookups.departmentManager(requesterId);
      if (m) return [m];
      // graceful fallback: direct manager, so routing never dead-ends
      const dm = await lookups.requesterManager(requesterId);
      return dm ? [dm] : [];
    }
    case "ANY_APPROVER":
    default:
      return lookups.allApprovers();
  }
}

export async function canUserDecideStep(opts: {
  step: StepTargetInput | null | undefined;
  userId: string;
  requesterId: string;
  isSuperAdmin: boolean;
  hasApprovePerm: boolean;
  lookups: StepLookups;
  /** user IDs that already recorded a decision on this step in the current round */
  decidedUserIds?: string[];
}): Promise<{ canDecide: boolean; reason: string | null }> {
  if (opts.decidedUserIds?.includes(opts.userId)) {
    return { canDecide: false, reason: 'You have already decided on this step' };
  }
  if (opts.isSuperAdmin) return { canDecide: true, reason: null };
  if (!opts.step) return { canDecide: false, reason: "No active approval step" };
  const ids = await stepTargetUserIds(opts.step, opts.requesterId, opts.lookups);
  if (ids.length === 0) {
    return {
      canDecide: false,
      reason: `Nobody is assigned to this step (${describeStepTarget(opts.step)}) — contact your administrator`,
    };
  }
  // A directly-targeted approver may decide even without the blanket REQUEST_APPROVE
  // permission — e.g. a Self User who manages a department and receives approvals
  // through the normal workflow. ANY_APPROVER stays permission-driven.
  if (ids.includes(opts.userId) && opts.step.ApproverType !== 'ANY_APPROVER') {
    return { canDecide: true, reason: null };
  }
  if (!opts.hasApprovePerm) {
    return { canDecide: false, reason: "You do not have approval permission" };
  }
  if (ids.includes(opts.userId)) return { canDecide: true, reason: null };
  return {
    canDecide: false,
    reason: `Only ${describeStepTarget(opts.step)} can decide this step`,
  };
}
