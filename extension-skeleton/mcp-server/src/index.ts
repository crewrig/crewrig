import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// The server info is its own object literal, broken across lines, so the formatted output of a
// scaffold does not depend on the length of the extension name.
const serverInfo = {
  name: "${SKELETON_NAME}",
  version: "0.1.0",
};

const server = new Server(serverInfo, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sample_tool",
      description: "A placeholder tool — replace with your own",
      inputSchema: {
        type: "object" as const,
        properties: {
          input: { type: "string", description: "Sample input parameter" },
        },
        required: ["input"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "sample_tool") {
    throw new McpError(ErrorCode.MethodNotFound, `No such tool: ${request.params.name}`);
  }

  const input = String(request.params.arguments?.input ?? "");
  return {
    content: [{ type: "text", text: `Received: ${input}` }],
  };
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to start", serverInfo.name, "MCP server:", err);
  process.exit(1);
});
