import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const bundlePatch = join(packageRoot, 'cordis.patch.yml')
const pluginModule = pathToFileURL(join(packageRoot, 'test/fixtures/mcp-config-probe.mjs')).href
const knowvEnvNames = ['KNOWV_MCP_SERVER_URL', 'KNOWV_MCP_API_KEY']

async function withKnowvEnvironment(values, run) {
  const previous = new Map(knowvEnvNames.map(name => [name, process.env[name]]))
  for (const name of knowvEnvNames) delete process.env[name]
  Object.assign(process.env, values)

  try {
    await run()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

async function withBootedProbe(values, inspect) {
  await withKnowvEnvironment(values, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowv-dsh-plugin-'))
    const rootConfig = join(dir, 'cordis.yml')
    writeFileSync(rootConfig, '[]\n')

    let ctx
    try {
      const patches = loadOverlayPatches('knowv-dsh-plugin-test', bundlePatch)
      const entry = patches.flatMap(patch => patch.insert ?? [])
        .find(candidate => candidate.id === 'knowv-mcp')
      assert.ok(entry, 'the bundle patch should insert the KnowV entry')
      entry.name = pluginModule

      ctx = await boot(
        'knowv-dsh-plugin-test',
        rootConfig,
        patches,
      )
      await inspect(ctx)
    } finally {
      await ctx?.fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

async function expectBundleDisabled(values) {
  await withBootedProbe(values, async (ctx) => {
      const loaderEntry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'knowv-mcp')
      assert.ok(loaderEntry, 'the KnowV bundle should keep its Loader entry visible')
      assert.equal(loaderEntry.disabled, true)
      assert.equal(loaderEntry.fiber, undefined)
  })
}

test('unconfigured deployment states leave KnowV installed but disabled', async () => {
  await expectBundleDisabled({})
  await expectBundleDisabled({ KNOWV_MCP_API_KEY: '   ' })
  await expectBundleDisabled({ KNOWV_MCP_SERVER_URL: 'https://legacy.invalid/mcp' })
})

test('configured API keys use the official endpoint instead of an environment URL', async () => {
  await withBootedProbe({
    KNOWV_MCP_SERVER_URL: 'https://legacy.invalid/mcp',
    KNOWV_MCP_API_KEY: '  diagnostic-key  ',
  }, async (ctx) => {
    const config = ctx.get('knowvConfigProbe')
    assert.equal(config.url, 'https://console.knowvai.com/mcp')
    assert.deepEqual(config.headers, { Authorization: 'Bearer diagnostic-key' })
  })
})
