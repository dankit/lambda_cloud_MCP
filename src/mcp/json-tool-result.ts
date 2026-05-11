/** FastMCP tool execute handlers must return ContentResult, plain string, or void. */
export function jsonToolResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, undefined, 2),
      },
    ],
  };
}
