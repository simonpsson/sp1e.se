export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, params } = ctx;
  const route  = ((params.route as string[]) ?? []).join('/');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  try {
    if (route === 'health' && method === 'GET') {
      return json({ status: 'ok' });
    }

    return json({ error: 'not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'internal error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
