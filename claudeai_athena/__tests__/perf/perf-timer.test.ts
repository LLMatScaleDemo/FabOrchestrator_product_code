/**
 * PhaseTimer tests — the instrument we use to answer "where did the seconds go?"
 * on chat time-to-first-token. If these numbers are wrong we optimise the wrong
 * thing, so the shape of the emitted `perf` line is pinned down here.
 *
 * Run with: npx tsx --test __tests__/perf/perf-timer.test.ts
 *
 * Uses the built-in `node:test` runner (same convention as the error and
 * validation suites); jest in this app is reserved for the a11y suite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PhaseTimer } from '../../lib/perf-timer';
import { logger } from '../../lib/logger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Capture what the timer emits instead of writing it to stdout.
// The emitted perf line is a free-form structured log payload; `unknown`
// keeps it honest and the assertions below cast at the point of use.
type PerfLine = Record<string, unknown>;
let emitted: PerfLine[] = [];
let originalInfo: typeof logger.info;

beforeEach(() => {
  emitted = [];
  originalInfo = logger.info;
  logger.info = ((msg: string, ctx: PerfLine = {}) => {
    if (msg === 'perf') emitted.push(ctx);
  }) as typeof logger.info;
});

afterEach(() => {
  logger.info = originalInfo;
});

function onlyLine(): PerfLine {
  assert.equal(emitted.length, 1, 'expected exactly one perf line');
  return emitted[0];
}

describe('PhaseTimer', () => {
  it('attributes elapsed time to the phase that spent it', async () => {
    const t = new PhaseTimer('chat', { route: '/api/chat' });
    await sleep(60);
    t.mark('slowPhase');
    t.mark('fastPhase');
    t.flush();

    const line = onlyLine();
    assert.ok(line.phases.slowPhase >= 50, `slowPhase=${line.phases.slowPhase}`);
    assert.ok(line.phases.fastPhase < 50, `fastPhase=${line.phases.fastPhase}`);
    // The worst offender must sort first — that's the thing we act on.
    assert.match(line.slowest[0], /^slowPhase=/);
    assert.equal(line.route, '/api/chat');
    assert.equal(line.label, 'chat');
  });

  it('records time-to-first-token once, ignoring later chunks', async () => {
    const t = new PhaseTimer('chat');
    await sleep(40);
    t.markFirstToken();
    await sleep(40);
    t.markFirstToken(); // a later chunk must not move TTFT
    t.flush();

    const line = onlyLine();
    assert.ok(line.ttftMs >= 35, `ttft=${line.ttftMs}`);
    assert.ok(line.ttftMs < line.totalMs, 'ttft must precede total');
  });

  it('reports null ttft when the stream never produced a token', () => {
    const t = new PhaseTimer('chat');
    t.mark('preflight');
    t.flush({ outcome: 'preflight-error' });

    const line = onlyLine();
    assert.equal(line.ttftMs, null);
    assert.equal(line.outcome, 'preflight-error');
  });

  it('accumulates a repeated phase instead of overwriting it', async () => {
    const t = new PhaseTimer('chat');
    for (let i = 0; i < 3; i++) {
      await sleep(20);
      t.mark('step:mcp_query');
    }
    t.flush();

    assert.ok(onlyLine().phases['step:mcp_query'] >= 50);
  });

  it('times a wrapped call and still records it when the call throws', async () => {
    const t = new PhaseTimer('chat');
    await assert.rejects(
      t.time('failingQuery', async () => {
        await sleep(30);
        throw new Error('db down');
      }),
      /db down/
    );
    t.flush();

    assert.ok(onlyLine().phases.failingQuery >= 20);
  });

  it('reports what parallel tools actually cost vs running them serially', () => {
    // One step, three concurrent tools. The step waits for the slowest (5000ms),
    // not the sum (5600ms) — and the two fast ones sat idle for 4800ms.
    const t = new PhaseTimer('chat');
    t.recordTool('mcp_query_a', 5000, true, 0);
    t.recordTool('mcp_query_b', 400, true, 0);
    t.recordTool('mcp_query_c', 200, true, 0);
    t.flush();

    const line = onlyLine();
    assert.equal(line.toolCalls, 3);
    assert.equal(line.toolWaitedMs, 5000, 'step waits for the slowest tool');
    assert.equal(line.toolSerialMs, 5600, 'serial cost is the sum');
    assert.equal(line.toolBlockingMs, 4800, 'slowest minus fastest is the straggler wait');
    assert.match(line.parallelSteps[0], /3 parallel/);
    assert.match(line.parallelSteps[0], /slowest mcp_query_a=5000ms/);
  });

  it('sums the per-step waits across a multi-step turn', () => {
    const t = new PhaseTimer('chat');
    t.recordTool('a', 1000, true, 0);
    t.recordTool('b', 300, true, 0);
    t.recordTool('c', 2000, true, 1); // lone tool in step 1
    t.flush();

    const line = onlyLine();
    assert.equal(line.toolWaitedMs, 3000, '1000 (step0 slowest) + 2000 (step1)');
    assert.equal(line.toolBlockingMs, 700, 'only step0 had siblings to block');
  });

  it('does not count a single-tool step as parallel blocking', () => {
    const t = new PhaseTimer('chat');
    t.recordTool('solo', 4000, true, 0);
    t.flush();

    const line = onlyLine();
    assert.equal(line.toolBlockingMs, 0, 'nothing was blocked — there was no sibling');
    assert.deepEqual(line.parallelSteps, []);
    assert.equal(line.toolWaitedMs, 4000);
  });

  it('records a failed tool call without dropping it from the timings', () => {
    const t = new PhaseTimer('chat');
    t.recordTool('mcp_query', 2500, false, 0);
    t.flush();

    const line = onlyLine();
    // A tool that throttled and failed still cost the user 2.5s of waiting.
    assert.equal(line.toolDetail[0].ok, false);
    assert.equal(line.toolWaitedMs, 2500);
  });

  it('reports zeroes when the turn used no tools at all', () => {
    const t = new PhaseTimer('chat');
    t.flush();

    const line = onlyLine();
    assert.equal(line.toolCalls, 0);
    assert.equal(line.toolWaitedMs, 0);
    assert.equal(line.toolBlockingMs, 0);
  });

  it('keeps unaccounted time visible so gaps cannot hide', async () => {
    const t = new PhaseTimer('chat');
    t.mark('quick');
    await sleep(50); // deliberately never marked
    t.flush();

    assert.ok(onlyLine().unaccountedMs >= 40, 'unmarked time must be reported');
  });
});
