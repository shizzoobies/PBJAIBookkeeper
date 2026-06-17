// Shared BFF proxy for the dashboard's Pages Functions. The browser calls these
// same-origin endpoints (gated by Cloudflare Access); we forward each request to
// the Worker with the shared secret it requires. The Worker is therefore never
// reachable directly from the client. Underscore-prefixed → not itself a route.

export interface BffEnv {
  WORKER_ORIGIN: string
  BFF_SHARED_SECRET: string
}

interface PagesContext {
  request: Request
  env: BffEnv
}

export async function proxyToWorker({ request, env }: PagesContext): Promise<Response> {
  if (!env.BFF_SHARED_SECRET || !env.WORKER_ORIGIN) {
    return Response.json({ error: 'bff_not_configured' }, { status: 503 })
  }

  const incoming = new URL(request.url)
  const target = `${env.WORKER_ORIGIN}${incoming.pathname}${incoming.search}`

  const headers = new Headers(request.headers)
  headers.set('X-BFF-Secret', env.BFF_SHARED_SECRET)
  headers.delete('host')
  headers.delete('cookie') // never forward the Access session cookie upstream
  headers.delete('accept-encoding') // avoid body re-encoding mismatches

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const body = hasBody ? await request.arrayBuffer() : undefined

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual', // pass 302s (OAuth → Intuit) back to the browser unfollowed
  })

  const respHeaders = new Headers(upstream.headers)
  respHeaders.delete('content-length') // body may be re-chunked; let the runtime set it
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  })
}
