// Step-target resolution shared by the request/approval APIs.
// Pure logic + data callbacks (no prisma import, so clients can use describeStepTarget too).

export interface StepTargetInput {
  ApproverType: string;
  TargetUserID: string | null;
  TargetGroupID: string | null;
  TargetRoleID: string | null;
  TargetDEPID?: string | null;
  TargetUser?: { Name: string } | null;
  TargetGroup?: { Name: string } | null;
  TargetRole?: { Name: string } | null;
  TargetDEP?: { Name: string } | null;
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
      return "Requester's manager (direct, or department manager as fallback)";
    case "DEPARTMENT_MANAGER":
      return "Requester's department manager (or direct manager as fallback)";
    case "DEPARTMENT":
      return step.TargetDEP?.Name ? `Department: ${step.TargetDEP.Name}` : "A department (assign a handler)";
    case "ANY_APPROVER":
    default:
      return "Any approver";
  }
}

export async function stepTargetUserIds(
  step: StepTargetInput,
  requesterId: string,
  lookups: StepLookups,
  /** The request's current handler (AssigneeID). For DEPARTMENT steps the
   *  system never picks a person on the department's behalf — only the
   *  handler the team explicitly assigned can decide the step. */
  assignedUserId?: string | null
): Promise<string[]> {
  switch (step.ApproverType) {
    case "USER":
      return step.TargetUserID ? [step.TargetUserID] : [];
    case "ROLE":
      return step.TargetRoleID ? lookups.usersWithRole(step.TargetRoleID) : [];
    case "GROUP":
      return step.TargetGroupID ? lookups.groupMembers(step.TargetGroupID) : [];
    case "REQUESTER_MANAGER": {
      // Primary source is Users.DirectManagerID. Most organisations in PRSYS
      // carry the manager on the department instead (DEP.ManagerID), so fall
      // back to it — otherwise a requester without DirectManagerID parks every
      // request they file (this is the "Nobody is assigned to this step" case).
      const direct = await lookups.requesterManager(requesterId);
      if (direct) return [direct];
      const byDep = await lookups.departmentManager(requesterId);
      return byDep ? [byDep] : [];
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
    case "DEPARTMENT": {
      // The department TEAM owns this step — the system deliberately does NOT
      // auto-pick one of its people (no manager, no first member): the team
      // must coordinate and explicitly assign a handler to the ticket, and
      // only that handler may decide the step. Unassigned => nobody can
      // decide, which the UI surfaces as "Employee must be assigned".
      return assignedUserId ? [assignedUserId] : [];
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
  /** the request's current handler — DEPARTMENT steps resolve to it (see stepTargetUserIds) */
  assignedUserId?: string | null;
}): Promise<{ canDecide: boolean; reason: string | null }> {
  if (opts.decidedUserIds?.includes(opts.userId)) {
    return { canDecide: false, reason: 'You have already decided on this step' };
  }
  if (!opts.step) return { canDecide: false, reason: "No active approval step" };
  const isDeptStep = opts.step.ApproverType === 'DEPARTMENT';
  const deptName = opts.step.TargetDEP?.Name || 'the department';
  const ids = await stepTargetUserIds(opts.step, opts.requesterId, opts.lookups, opts.assignedUserId);
  const routedToMe = ids.includes(opts.userId);

  if (ids.length === 0) {
    if (isDeptStep) {
      // The expected, visible waiting state: the team must assign a handler.
      return {
        canDecide: false,
        reason:
          `Employee must be assigned — the ${deptName} team must assign a handler ` +
          `to this ticket before this step can be decided.`,
      };
    }
    return {
      canDecide: false,
      reason:
        `Nobody is assigned to this step (${describeStepTarget(opts.step)}) — ` +
        `set the requester's Direct manager (Users) or their department's Manager (Departments).`,
    };
  }

  // Super Admins administer users, departments and workflows — they do NOT
  // decide approval steps. A decision is only valid when the flow routes the
  // step to that person (as a target user, a targeted role/group member, or the
  // resolved manager). ANY_APPROVER never counts for them because their
  // REQUEST_APPROVE is implicit to the role, not a real assignment.
  if (opts.isSuperAdmin && !(routedToMe && opts.step.ApproverType !== 'ANY_APPROVER')) {
    return {
      canDecide: false,
      reason:
        `Administrators don't decide approval steps — this one belongs to ${describeStepTarget(opts.step)}.`,
    };
  }

  // A directly-targeted approver may decide even without the blanket REQUEST_APPROVE
  // permission — e.g. a Self User who manages a department and receives approvals
  // through the normal workflow. ANY_APPROVER stays permission-driven.
  if (routedToMe && opts.step.ApproverType !== 'ANY_APPROVER') {
    return { canDecide: true, reason: null };
  }
  if (!opts.hasApprovePerm) {
    return { canDecide: false, reason: "You do not have approval permission" };
  }
  if (routedToMe) return { canDecide: true, reason: null };
  return {
    canDecide: false,
    reason: isDeptStep
      ? `Only the handler assigned by the ${deptName} team can decide this step`
      : `Only ${describeStepTarget(opts.step)} can decide this step`,
  };
}
