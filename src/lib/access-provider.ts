import { createClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/auth-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuthProviderError } from "@/lib/auth-links";

export interface AccessIdentity {
  id: string; email?: string; email_confirmed_at?: string; invited_at?: string; last_sign_in_at?: string; banned_until?: string;
}
type IdentityResult = { user: AccessIdentity | null; error: AuthProviderError };
export interface AccessProvider {
  getIdentity(id: string): Promise<IdentityResult>;
  createIdentity(email: string, name: string): Promise<IdentityResult>;
  deleteIdentity(id: string): Promise<unknown>;
  invite(email: string, name: string, redirectTo: string): Promise<IdentityResult>;
  recover(email: string, redirectTo: string): Promise<{ error: AuthProviderError }>;
}
/** Mail links also work when opened on a different device; sessions remain in HTTP-only server cookies. */
export function authMailClient() {
  const { url, key } = supabasePublicConfig();
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit" },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12000), cache: "no-store" }) } });
}
export function accessProvider(): AccessProvider {
  const admin = supabaseAdmin();
  return {
    getIdentity: async id => { const { data, error } = await admin.auth.admin.getUserById(id); return { user: data.user, error }; },
    createIdentity: async (email, name) => { const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: false, user_metadata: { name } }); return { user: data.user, error }; },
    deleteIdentity: async id => { const { error } = await admin.auth.admin.deleteUser(id); if (error) throw new Error("AUTH_IDENTITY_CLEANUP_FAILED"); },
    invite: async (email, name, redirectTo) => { const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { name } }); return { user: data.user, error }; },
    recover: async (email, redirectTo) => { const { error } = await authMailClient().auth.resetPasswordForEmail(email, { redirectTo }); return { error }; },
  };
}
