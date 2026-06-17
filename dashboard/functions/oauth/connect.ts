import { proxyToWorker } from '../_shared'

// /oauth/connect runs behind Access and is proxied to the Worker, which 302s to
// Intuit. (Intuit's redirect to /oauth/callback targets the Worker directly and
// is state-protected, so it needs no Pages function here.)
export const onRequest = proxyToWorker
