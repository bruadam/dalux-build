-- Better Auth and invite tables belong to the interface only.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  auth_users, auth_sessions, auth_accounts, auth_verifications, account_invites
  TO web;
