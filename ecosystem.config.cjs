// Replaces the base image's process list: Purgatory runs only the API. The base
// image also starts an MCP server and the MCP Inspector (with auth disabled),
// which sandboxes could reach over traefik-net.
module.exports = {
  apps: [
    {
      name: "api",
      script: "node_modules/.bin/tsx",
      args: "server.ts",
    },
  ],
};
