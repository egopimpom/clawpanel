import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('Dashboard renders the agent list when it arrives after five seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const source = readFileSync('src/pages/dashboard.js', 'utf8')
  const start = source.indexOf('async function _loadDashboardDataInner(')
  const end = source.indexOf('\nasync function openGatewayConflict(', start)
  assert.ok(start >= 0 && end > start)
  const agents = [{ id: 'fixture-agent' }]
  const rendered = []
  let requestStarted
  const started = new Promise(resolve => { requestStarted = resolve })
  const empty = async () => []
  const context = vm.createContext({
    setTimeout, console, _dashboardLoadSeq: 1, _dashboardInitialized: true,
    _dashboardVersionCache: { current: 'fixture' }, _dashboardStatusSummaryCache: null,
    syncDashboardInstanceScope() {}, versionInfoIncomplete: () => false,
    renderStatCards() {}, renderLogs() {}, renderOnboarding() {},
    renderOverview: (...args) => rendered.push(args[5]),
    api: {
      getServicesStatus: empty, readOpenclawConfig: async () => null, readPanelConfig: async () => null,
      readMcpConfig: empty, listBackups: empty, listConfiguredPlatforms: empty, readLogTail: empty,
      listAgents: () => new Promise(resolve => {
        setTimeout(() => resolve(agents), 6000)
        requestStarted()
      }),
    },
  })
  vm.runInContext(source.slice(start, end), context)
  const load = context._loadDashboardDataInner({ isConnected: true }, false, 1)
  await started
  t.mock.timers.tick(5500)
  await Promise.resolve()
  assert.equal(rendered.length, 0)
  t.mock.timers.tick(500)
  await load
  assert.equal(rendered[0], agents)
})
