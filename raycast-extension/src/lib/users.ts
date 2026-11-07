import type { RankField } from "./rank";

/** The subset of the client's `ProjectUserSchema` used here. */
export interface ProjectUser {
  userId: string;
  userType?: string | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  companyId?: string | null;
}

export interface UserEntry {
  userId: string;
  name: string;
  email: string;
  userType?: string;
  companyId?: string;
  companyName?: string;
}

export function toUserEntry(user: ProjectUser, companyNames: Map<string, string>): UserEntry {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    userId: user.userId,
    name: name || user.email,
    email: user.email,
    userType: user.userType ?? undefined,
    companyId: user.companyId ?? undefined,
    companyName: (user.companyId && companyNames.get(user.companyId)) || undefined,
  };
}

export function userRankFields(user: UserEntry): RankField[] {
  return [
    { text: user.name, weight: 3 },
    { text: user.email, weight: 2 },
    { text: user.companyName, weight: 1 },
  ];
}
