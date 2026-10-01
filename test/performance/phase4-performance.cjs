// Read-only benchmark on a disposable local final-schema *_test DB. Run after build with --expose-gc.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('package.json'));
req('reflect-metadata');
const { PrismaClient } = req('./dist/generated/prisma/client.js');
const { PrismaPg } = req('@prisma/adapter-pg');
const { Client } = req('pg');
const { FinanceService } = req('./dist/src/modules/admin/finance.service.js');
const { ContractRepository } = req('./dist/src/modules/contract/repository/contract.repository.js');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  assert(global.gc, 'Run with --expose-gc');
  const expert = Number(process.env.PHASE4_PERF_EXPERT_ID);
  assert(Number.isSafeInteger(expert) && expert > 0);
  const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [{ emit: 'event', level: 'query' }] });
  const db = new Client({ connectionString: url.toString() });
  await p.$connect(); await db.connect();
  let queries = [];
  p.$on('query', e => queries.push(e));
  const result = { counts: { contracts: await p.contract.count(), installments: await p.contractInstallment.count() }, measurements: {}, plans: {} };
  assert(result.counts.contracts >= 40000 && result.counts.installments >= 60000);
  const repo = Object.assign(new ContractRepository(), { prisma: p });
  const finance = new FinanceService(p);
  try {
    for (const [name, fn] of Object.entries({ contracts20: () => repo.findAllByStatus(undefined, expert), contracts100: () => repo.findAllByStatus(undefined, expert, { limit: 100 }), earnings20: () => finance.getExpertEarnings(expert), earnings100: () => finance.getExpertEarnings(expert, { limit: 100 }) })) {
      global.gc(); queries = [];
      const base = process.memoryUsage().heapUsed, start = performance.now();
      const response = await fn();
      const ms = performance.now() - start, heapMiB = (process.memoryUsage().heapUsed - base) / 1048576;
      const selects = queries.filter(q => /^\s*(SELECT|WITH)/i.test(q.query));
      result.measurements[name] = { ms, heapMiB, bytes: Buffer.byteLength(JSON.stringify(response)), rows: (response.data ?? response.contracts).length, total: response.total, selectQueries: selects.length, sqlMs: selects.reduce((sum, q) => sum + q.duration, 0) };
      result.plans[name] = [];
      for (const q of selects) {
        const plan = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + q.query, JSON.parse(q.params));
        result.plans[name].push({ sql: q.query, plan: plan.rows[0]['QUERY PLAN'][0] });
      }
    }
    for (const [name, sql] of Object.entries({ beforeContractRows: 'SELECT * FROM "Contract" ORDER BY "createdAt" DESC', beforeEarningsRows: 'SELECT * FROM "Contract" WHERE "signedByUserId"=$1 ORDER BY "createdAt" DESC', beforeInstallmentRows: 'SELECT i.* FROM "ContractInstallment" i JOIN "Contract" c ON c.id=i."contractId" WHERE c."signedByUserId"=$1' })) {
      const plan = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, sql.includes('$1') ? [expert] : []);
      result.plans[name] = plan.rows[0]['QUERY PLAN'][0];
    }
    for (const prefix of ['contracts', 'earnings']) {
      assert.equal(result.measurements[prefix + '20'].rows, 20);
      assert.equal(result.measurements[prefix + '100'].rows, 100);
      assert.equal(result.measurements[prefix + '20'].selectQueries, result.measurements[prefix + '100'].selectQueries, 'No per-row query growth');
    }
    const output = process.env.PHASE4_PERF_OUTPUT ?? path.join(tmpdir(), 'oxus-phase4-performance-after.json');
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ counts: result.counts, measurements: result.measurements, output }));
  } finally { await p.$disconnect(); await db.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
