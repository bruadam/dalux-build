import 'server-only';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { accounts, authAccounts, authSessions, authUsers, authVerifications } from '@dalux-platform/db';
import { db } from './server/db';
import { UserError } from './server/errors';
import { accountForNewLogin } from './server/signup';

const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';

function createAuth() {
  return betterAuth({
    baseURL: publicUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: { authUsers, authSessions, authAccounts, authVerifications },
    }),
    user: {
      modelName: 'authUsers',
      additionalFields: { platformAccountId: { type: 'string', input: false } },
    },
    session: { modelName: 'authSessions' },
    account: { modelName: 'authAccounts' },
    verification: { modelName: 'authVerifications' },
    emailAndPassword: {
      // @node-rs/argon2 hashes with Argon2id by default (PRD 7.4).
      enabled: true,
      autoSignIn: false,
      password: {
        hash: (password) => hash(password),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 5 } },
    },
    advanced: { useSecureCookies: publicUrl.startsWith('https://') },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            try {
              return { data: { ...user, platformAccountId: await accountForNewLogin(db(), user.email) } };
            } catch (error) {
              if (error instanceof UserError) throw new APIError('FORBIDDEN', { message: error.message });
              throw error;
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [row] = await db()
              .select({ status: accounts.status })
              .from(authUsers)
              .innerJoin(accounts, eq(accounts.id, authUsers.platformAccountId))
              .where(eq(authUsers.id, session.userId));
            if (row?.status !== 'active') return false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Created on first use, so `next build` does not need runtime secrets. */
export function auth() {
  instance ??= createAuth();
  return instance;
}
