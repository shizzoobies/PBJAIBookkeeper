import { proxyToWorker } from '../_shared'

// Catch-all: every /api/* request (already authenticated by Cloudflare Access at
// the edge) is proxied to the Worker with the BFF shared secret.
export const onRequest = proxyToWorker
