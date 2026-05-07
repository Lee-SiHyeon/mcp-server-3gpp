/**
 * Tool registry — maps tool names to handlers and schemas.
 */
export const tools = new Map();

export function registerTool(name, schema, handler) {
  tools.set(name, { schema, handler });
}

export function getToolList() {
  return [...tools.entries()].map(([name, { schema }]) => {
    const tool = {
      name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    };
    if (schema.outputSchema) tool.outputSchema = schema.outputSchema;
    if (schema.annotations) tool.annotations = schema.annotations;
    return tool;
  });
}
