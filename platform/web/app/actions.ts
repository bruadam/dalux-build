'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import type { Preset } from '@/lib/capabilities';
import type { FormState } from '@/lib/form-state';
import { inviteAccount, reissueInvite, setAccountRole, setAccountStatus } from '@/lib/server/accounts';
import type { Actor } from '@/lib/server/actor';
import { agentInputFrom, createOwnAgent, deleteOwnAgent, runAgentNow, stopAnyAgent, switchAgent, updateOwnAgent } from '@/lib/server/agents';
import { addConnection, rotateConnectionKey } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { linkDaluxUser, requestDaluxUserMatch, unlinkDaluxUser } from '@/lib/server/daluxUsers';
import { UserError } from '@/lib/server/errors';
import { createGrant, deleteGrant } from '@/lib/server/grants';
import { createIndexScope, deleteIndexScope, requestIndexRefresh, updateIndexScope } from '@/lib/server/indexScopes';
import { addMember, createGroup, deleteGroup, removeMember } from '@/lib/server/groups';
import { deleteAllMemory, deleteMemoryEntry, editMemoryEntry, switchMemory } from '@/lib/server/memory';
import { decideAuthorization, revokeOAuthSession } from '@/lib/server/oauth';
import { createRobot, reassignRobotOwner } from '@/lib/server/robots';
import { requireActor } from '@/lib/server/session';
import { setAuditRetentionDays, setEmbeddingKey, setHeaderMode } from '@/lib/server/settings';
import { signUp } from '@/lib/server/signup';
import { createApiToken, revokeApiToken } from '@/lib/server/tokens';

const text = (form: FormData, name: string) => String(form.get(name) ?? '');
const role = (form: FormData) => (text(form, 'role') === 'admin' ? 'admin' : 'user');

/**
 * Runs a change as the signed-in account. Each domain function checks its own
 * permissions; `UserError` messages are shown, anything else is logged.
 */
async function run(change: (actor: Actor) => Promise<FormState | void>): Promise<FormState> {
  const actor = await requireActor();
  try {
    const result = (await change(actor)) ?? {};
    revalidatePath('/', 'layout');
    return { done: true, ...result };
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    console.error(error);
    return { error: 'Something went wrong. Check the server log.' };
  }
}

async function inviteLink(token: string): Promise<string> {
  const base = process.env.PUBLIC_URL ?? `http://${(await headers()).get('host')}`;
  return `${base}/signup?invite=${encodeURIComponent(token)}`;
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email');
  const password = text(form, 'password');
  try {
    await signUp(
      db(),
      async (login) => {
        await auth().api.signUpEmail({ body: login });
      },
      { email, password, name: text(form, 'name'), inviteToken: text(form, 'invite') || undefined },
    );
    await auth().api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    return { error: (error as Error).message || 'Sign-up failed' };
  }
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await auth().api.signOut({ headers: await headers() });
  redirect('/login');
}

export const createOwnTokenAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    const { token } = await createApiToken(db(), actor, {
      accountId: actor.accountId,
      name: text(form, 'name'),
      connectionId: text(form, 'connectionId'),
      expiresInDays: Number(text(form, 'expiresInDays')) || undefined,
    });
    return { secret: { label: 'Copy this token now. It is not shown again.', value: token } };
  });

export const createRobotTokenAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    const { token } = await createApiToken(db(), actor, {
      accountId: text(form, 'accountId'),
      name: text(form, 'name'),
      connectionId: text(form, 'connectionId'),
      expiresInDays: Number(text(form, 'expiresInDays')) || undefined,
    });
    return { secret: { label: 'Copy this token now. It is not shown again.', value: token } };
  });

export const revokeTokenAction = async (_: FormState, form: FormData) =>
  run((actor) => revokeApiToken(db(), actor, text(form, 'tokenId')));

export const revokeOAuthSessionAction = async (_: FormState, form: FormData) =>
  run((actor) => revokeOAuthSession(db(), actor, text(form, 'sessionId')));

/** The consent page's Approve / Deny: sends the browser back to the MCP client. */
export async function approveAuthorizationAction(_: FormState, form: FormData): Promise<FormState> {
  let target: string | undefined;
  const state = await run(async (actor) => {
    target = await decideAuthorization(db(), actor, new URLSearchParams(text(form, 'query')), {
      approve: text(form, 'decision') !== 'deny',
      connectionId: text(form, 'connectionId'),
      capabilities: form.getAll('capabilities').map(String),
    });
  });
  if (target) redirect(target);
  return state;
}

export const inviteAccountAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    const { inviteToken } = await inviteAccount(db(), actor, { email: text(form, 'email'), name: text(form, 'name'), role: role(form) });
    return { secret: { label: 'Send this invite link to the person. It works once, for 7 days.', value: await inviteLink(inviteToken) } };
  });

export const reissueInviteAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    const token = await reissueInvite(db(), actor, text(form, 'accountId'));
    return { secret: { label: 'New invite link (works once, for 7 days):', value: await inviteLink(token) } };
  });

export const setAccountStatusAction = async (_: FormState, form: FormData) =>
  run((actor) => setAccountStatus(db(), actor, text(form, 'accountId'), text(form, 'status') === 'disabled' ? 'disabled' : 'active'));

export const setAccountRoleAction = async (_: FormState, form: FormData) =>
  run((actor) => setAccountRole(db(), actor, text(form, 'accountId'), role(form)));

export const createRobotAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    await createRobot(db(), actor, { name: text(form, 'name'), description: text(form, 'description'), ownerAccountId: text(form, 'ownerAccountId') });
  });

export const reassignRobotOwnerAction = async (_: FormState, form: FormData) =>
  run((actor) => reassignRobotOwner(db(), actor, text(form, 'robotId'), text(form, 'ownerAccountId')));

export const createGroupAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    await createGroup(db(), actor, { name: text(form, 'name'), description: text(form, 'description') });
  });

export const deleteGroupAction = async (_: FormState, form: FormData) =>
  run((actor) => deleteGroup(db(), actor, text(form, 'groupId')));

export const addMemberAction = async (_: FormState, form: FormData) =>
  run((actor) => addMember(db(), actor, text(form, 'groupId'), text(form, 'accountId')));

export const removeMemberAction = async (_: FormState, form: FormData) =>
  run((actor) => removeMember(db(), actor, text(form, 'groupId'), text(form, 'accountId')));

export const addConnectionAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    await addConnection(db(), actor, {
      name: text(form, 'name'),
      slug: text(form, 'slug'),
      baseUrl: text(form, 'baseUrl'),
      apiKey: text(form, 'apiKey'),
    });
  });

export const rotateConnectionKeyAction = async (_: FormState, form: FormData) =>
  run((actor) => rotateConnectionKey(db(), actor, text(form, 'connectionId'), text(form, 'apiKey')));

export const createGrantAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    const [principalType, principalId] = text(form, 'principal').split(':');
    await createGrant(db(), actor, {
      accountId: principalType === 'account' ? principalId : undefined,
      groupId: principalType === 'group' ? principalId : undefined,
      connectionId: text(form, 'connectionId'),
      projectId: text(form, 'projectId'),
      fileAreaId: text(form, 'fileAreaId'),
      folderId: text(form, 'folderId'),
      preset: text(form, 'preset') === 'reader' ? ('reader' satisfies Preset) : undefined,
      capabilities: form.getAll('capabilities').map(String),
    });
  });

export const deleteGrantAction = async (_: FormState, form: FormData) =>
  run((actor) => deleteGrant(db(), actor, text(form, 'grantId')));

export const setEmbeddingKeyAction = async (_: FormState, form: FormData) =>
  run((actor) => setEmbeddingKey(db(), actor, text(form, 'clear') ? null : text(form, 'apiKey')));

export const setAuditRetentionAction = async (_: FormState, form: FormData) =>
  run((actor) => setAuditRetentionDays(db(), actor, Number(text(form, 'days'))));

export const setHeaderModeAction = async (_: FormState, form: FormData) =>
  run((actor) => setHeaderMode(db(), actor, text(form, 'enabled') === 'on'));

export const createIndexScopeAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    await createIndexScope(db(), actor, {
      connectionId: text(form, 'connectionId'),
      kind: text(form, 'kind'),
      name: text(form, 'name'),
      intervalHours: Number(text(form, 'intervalHours') || 6),
      scope: {
        projectId: text(form, 'projectId'),
        fileAreaId: text(form, 'fileAreaId'),
        folderId: text(form, 'folderId'),
        folderPath: text(form, 'folderPath'),
        recursive: text(form, 'recursive') === 'on',
        extensions: text(form, 'extensions'),
        includeDrawings: text(form, 'includeDrawings') === 'on',
        typeId: text(form, 'typeId'),
        filter: text(form, 'filter'),
        owner: text(form, 'owner'),
        repo: text(form, 'repo'),
        ref: text(form, 'ref'),
        path: text(form, 'path'),
      },
    });
  });

export const updateIndexScopeAction = async (_: FormState, form: FormData) =>
  run((actor) =>
    updateIndexScope(db(), actor, text(form, 'scopeId'), {
      enabled: text(form, 'enabled') === 'on',
      intervalHours: Number(text(form, 'intervalHours')),
    }),
  );

export const refreshIndexScopeAction = async (_: FormState, form: FormData) =>
  run((actor) => requestIndexRefresh(db(), actor, text(form, 'scopeId')));

export const deleteIndexScopeAction = async (_: FormState, form: FormData) =>
  run((actor) => deleteIndexScope(db(), actor, text(form, 'scopeId')));

export const linkDaluxUserAction = async (_: FormState, form: FormData) =>
  run((actor) =>
    linkDaluxUser(db(), actor, { accountId: text(form, 'accountId'), connectionId: text(form, 'connectionId'), daluxUserId: text(form, 'daluxUserId') }),
  );

export const unlinkDaluxUserAction = async (_: FormState, form: FormData) =>
  run((actor) => unlinkDaluxUser(db(), actor, { accountId: text(form, 'accountId'), connectionId: text(form, 'connectionId') }));

export const matchDaluxUsersAction = async (_: FormState, form: FormData) =>
  run((actor) => requestDaluxUserMatch(db(), actor, text(form, 'connectionId')));

const memoryProject = (form: FormData) => ({ connectionId: text(form, 'connectionId'), projectId: text(form, 'projectId') });

export const switchMemoryAction = async (_: FormState, form: FormData) =>
  run((actor) => switchMemory(db(), actor, { ...memoryProject(form), enabled: text(form, 'enabled') === 'true' }));

export const editMemoryAction = async (_: FormState, form: FormData) =>
  run((actor) => editMemoryEntry(db(), actor, { ...memoryProject(form), id: text(form, 'id'), text: text(form, 'text') }));

export const deleteMemoryAction = async (_: FormState, form: FormData) =>
  run((actor) => deleteMemoryEntry(db(), actor, { ...memoryProject(form), id: text(form, 'id') }));

export const deleteAllMemoryAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    await deleteAllMemory(db(), actor, memoryProject(form));
  });

export const createAgentAction = async (_: FormState, form: FormData) =>
  run(async (actor) => {
    await createOwnAgent(db(), actor, agentInputFrom(form));
  });

export const updateAgentAction = async (_: FormState, form: FormData) =>
  run((actor) => updateOwnAgent(db(), actor, text(form, 'agentId'), agentInputFrom(form)));

export const switchAgentAction = async (_: FormState, form: FormData) =>
  run((actor) => switchAgent(db(), actor, text(form, 'agentId'), text(form, 'enabled') === 'true'));

export const runAgentNowAction = async (_: FormState, form: FormData) => run((actor) => runAgentNow(db(), actor, text(form, 'agentId')));

export const deleteAgentAction = async (_: FormState, form: FormData) => run((actor) => deleteOwnAgent(db(), actor, text(form, 'agentId')));

export const stopAgentAction = async (_: FormState, form: FormData) =>
  run((actor) => stopAnyAgent(db(), actor, text(form, 'agentId'), text(form, 'stop') === 'true'));
