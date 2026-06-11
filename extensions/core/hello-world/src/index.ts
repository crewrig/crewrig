#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "hello-world", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "greet",
      description: "Produce a greeting for the given name",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Who to greet" },
        },
        required: ["name"],
      },
    },
    {
      name: "farewell",
      description: "Say goodbye to someone by name",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Who to say goodbye to" },
        },
        required: ["name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const who = String(request.params.arguments?.name ?? "World");

  switch (request.params.name) {
    case "greet":
      return {
        content: [{ type: "text", text: `Hello, ${who}! Sent from the hello-world extension.` }],
      };
    case "farewell":
      return {
        content: [{ type: "text", text: `Goodbye, ${who}! Until next time.` }],
      };
    default:
      throw new McpError(ErrorCode.MethodNotFound, `No such tool: ${request.params.name}`);
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to start hello-world MCP server:", err);
  process.exit(1);
});
