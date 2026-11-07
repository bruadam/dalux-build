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

/** The subset of the client's `ProjectCompanySchema` shown in a user's profile. */
export interface Company {
  companyId?: string | null;
  name?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface UserEntry {
  userId: string;
  name: string;
  email: string;
  userType?: string;
  companyId?: string;
  companyName?: string;
  companyVatNumber?: string;
  /** Address, postal code and city, and country joined into one line. */
  companyAddress?: string;
}

export function toUserEntry(user: ProjectUser, companies: Map<string, Company>): UserEntry {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const company = user.companyId ? companies.get(user.companyId) : undefined;
  const town = [company?.postalCode, company?.city].filter(Boolean).join(" ");
  const address = [company?.address, town, company?.country].filter(Boolean).join(", ");
  return {
    userId: user.userId,
    name: name || user.email,
    email: user.email,
    userType: user.userType ?? undefined,
    companyId: user.companyId ?? undefined,
    companyName: company?.name || undefined,
    companyVatNumber: company?.vatNumber || undefined,
    companyAddress: address || undefined,
  };
}

export function userRankFields(user: UserEntry): RankField[] {
  return [
    { text: user.name, weight: 3 },
    { text: user.email, weight: 2 },
    { text: user.companyName, weight: 1 },
  ];
}
