/**
 * Keeps a sandbox awake from a connection that does not pass Sablier (Docker access): renews every `intervalMs`,
 * but only when bytes went through in that time. An open connection alone does not count: Docker Desktop keeps a
 * sandbox's context connected for its Builds view without sending anything, which kept the sandbox up for good.
 */
export function startTrafficKeepAlive(lastTraffic: () => number, renew: () => void, intervalMs = 60_000): () => void {
  const t = setInterval(() => { if (Date.now() - lastTraffic() < intervalMs) renew() }, intervalMs)
  return () => clearInterval(t)
}
