import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { allowedOrigins, AuthConfigurationError } from '@/lib/auth-config';

export class AppError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); this.name = 'AppError'; }
}

export function assertOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins().has(origin)) throw new AppError('O endereço usado para acessar o ERP não está autorizado. O administrador deve conferir APP_URL e as origens permitidas desta instalação.', 403, 'ORIGIN_NOT_ALLOWED');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Solicitação entre sites não permitida.', 403, 'CROSS_SITE_BLOCKED');
}

type RouteContext = { params: Promise<Record<string, string>> };
type Handler = (request: NextRequest, context: RouteContext) => Promise<Response>;
function errorResponse(error: unknown): Response {
  if (error instanceof AppError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  if (error instanceof AuthConfigurationError) return NextResponse.json({ error: error.message, code: 'AUTH_CONFIGURATION' }, { status: 503 });
  if (error instanceof ZodError) { const issue = error.issues[0]; return NextResponse.json({ error: `${issue?.path.join('.') || 'Dados'}: ${issue?.message || 'inválidos'}` }, { status: 400 }); }
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  if (error instanceof Prisma.PrismaClientInitializationError || (error instanceof Prisma.PrismaClientKnownRequestError && ['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017', 'P2024'].includes(error.code))) return NextResponse.json({ error: 'O banco de dados está temporariamente indisponível. Nenhuma confirmação de operação foi recebida. Tente novamente após verificar o serviço.', code: 'DATABASE_UNAVAILABLE' }, { status: 503 });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return NextResponse.json({ error: 'Código, e-mail ou identificação já cadastrado.' }, { status: 409 });
    if (error.code === 'P2025') return NextResponse.json({ error: 'Registro não encontrado.' }, { status: 404 });
    if (error.code === 'P2003') return NextResponse.json({ error: 'Este registro possui vínculos ou uma referência não existe.' }, { status: 409 });
    if (error.code === 'P2034') return NextResponse.json({ error: 'O registro foi alterado por outra operação. Atualize e tente novamente.' }, { status: 409 });
  }
  // Provider/driver messages and metadata may contain credentials. Log only a bounded code.
  const database = error instanceof Prisma.PrismaClientKnownRequestError;
  console.error('API request failed', {
    type: database ? 'database' : 'internal',
    ...(database && /^P\d{4}$/.test(error.code) ? { code: error.code } : {}),
  });
  return NextResponse.json({ error: 'Não foi possível concluir a operação. Tente novamente.' }, { status: 500 });
}
export function api(handler: Handler) {
  return async (request: NextRequest, context: RouteContext) => {
    let response: Response;
    try { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assertOrigin(request); response = await handler(request, context); }
    catch (error) { response = errorResponse(error); }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  };
}
export function json(data: unknown, status = 200) { return NextResponse.json({ data }, { status }); }
