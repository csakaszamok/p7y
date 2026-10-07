export function allocatePort(usedPorts: Set<number>, start: number, end: number): number | null {
  for (let port = start; port <= end; port++) {
    if (!usedPorts.has(port)) return port
  }
  return null
}
