import { Config } from '@deepseek-ai/dsh-mcp-client'

export { Config }

export function apply(ctx, config) {
  ctx.provide('knowvConfigProbe', config)
}
