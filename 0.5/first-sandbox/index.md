# First sandbox

```
# Create a sandbox
curl -X POST http://localhost:8081/sandboxes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "alice", "idle_timeout": "30m"}'

# Response (abridged)
{
  "name": "p7y-alice",
  "tunnel_urls": ["alice-inner-http-echo-port5678.lvh.me", "..."],
  "registry_url": "registry.lvh.me",
  "registry_username": "alice",
  "registry_password": "...",
  "docker_access": { "host": "alice-docker.lvh.me", "state": "ready" },
  "extras": {}
}
```

Sign in at `http://p7y.<HOST_DOMAIN>` to create sandboxes in the browser or mint a personal access token for your agents.

With `"template": "portainer"` the sandbox also gets Portainer, and `extras` has its `portainer_url` and `portainer_password`.
