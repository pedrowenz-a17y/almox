import { z } from 'zod';
import { api, AppError, json } from '@/lib/http';
import { appOrigin, authServiceUnavailable } from '@/lib/auth-config';
import { authRateLimit } from '@/lib/auth-rate-limit';
import { supabaseServer } from '@/lib/supabase/server';
const inputSchema = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()) }).strict();
export const POST = api(async request => {
  const { email } = inputSchema.parse(await request.json());
  await authRateLimit('recovery', email);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appOrigin()}/auth/callback?next=/recuperar-senha` });
  if (error && (authServiceUnavailable(error) || error.status === 429)) throw new AppError('O envio de recuperação está temporariamente indisponível. Aguarde e tente novamente.', error.status === 429 ? 429 : 503);
  // Same answer for nonexistent accounts and unauthorized ERP identities.
  return json({ message: 'Se houver uma conta habilitada para este e-mail, você receberá as instruções de recuperação.' });
});
