import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { advanceClaim, readFreeMintConfig, requestFreeMint, runFreeMintWorker, type FreeMintConfig, type MintChain, type MintRow, type PackTargets } from "./free-mint-core.ts";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";

const E18 = 10n ** 18n;
const PRICES = { coreAny: E18, coreSeal: (E18 * 5n) / 4n, blazar: 10n * E18, kage: 10n * E18, ashen: 15n * E18 };
const TARGETS: PackTargets = {
  core: { pack: "0xpack", nft: "0xnft" },
  blazar: { pack: "0xb", nft: "0xbn" },
  kage: { pack: "0xk", nft: "0xkn" },
  ashen: { pack: "0xa", nft: "0xan" },
};
const NOW = Date.parse("2026-12-01T12:00:00Z");
const KEY = "0x" + "11".repeat(32);

function config(over: Record<string, string> = {}): FreeMintConfig {
  return readFreeMintConfig({
    FEATURE_FREE_MINT: "1",
    FREE_MINT_SIGNER: KEY,
    FREE_MINT_START: "2026-12-01T00:00:00Z",
    FREE_MINT_END: "2026-12-08T00:00:00Z",
    FREE_MINT_PER_WALLET: "1",
    FREE_MINT_DAILY_CAP: "3",
    FREE_MINT_BUDGET_BZB: "10",
    FREE_MINT_EDITION: "core",
    ...over,
  });
}

let ids = 0;
const newId = () => `claim-${++ids}`;
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

async function played(sql: Sql, who: string, opts: { turns?: number; conceded?: boolean; at?: string } = {}) {
  await sql`insert into veil_room_results (room_id, wallet, win, turns, conceded, created_at)
    values (${`room-${who}-${Math.random()}`}, ${who.toLowerCase()}, ${true}, ${opts.turns ?? 8}, ${opts.conceded ?? false}, ${opts.at ?? "2026-12-01T06:00:00Z"}::timestamptz)`;
}

describe("free mint config", () => {
  it("is off and inert with no env at all", () => {
    const cfg = readFreeMintConfig({});
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.signerConfigured, false);
    assert.equal(cfg.budgetWei, 0n);
    assert.equal(cfg.dailyCap, 0);
    assert.equal(cfg.start, null);
  });
  it("clamps per-wallet to 2 and honours the stop file", () => {
    const cfg = readFreeMintConfig({ FREE_MINT_PER_WALLET: "9" }, { stopFileExists: () => true });
    assert.equal(cfg.perWallet, 2);
    assert.equal(cfg.stopped, true);
  });
  it("fails closed when the allowlist file is missing", () => {
    const cfg = readFreeMintConfig({ FREE_MINT_ALLOWLIST: "/nope" }, { readList: () => { throw new Error("missing"); } });
    assert.equal(cfg.allowlist?.size, 0);
  });
});

describe("free mint claims", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => ({ sql, close } = await memoryDb()));
  after(async () => close());
  beforeEach(async () => {
    await sql`delete from veil_free_mints`;
    await sql`delete from veil_room_results`;
  });

  const ask = (cfg: FreeMintConfig, who: string, ip = "1.1.1.1", now = NOW) => requestFreeMint(sql, cfg, { wallet: who, ip, now, prices: PRICES, newId });

  it("refuses when off, paused, out of window, or without a signer", async () => {
    await played(sql, wallet(1));
    assert.deepEqual(await ask(config({ FEATURE_FREE_MINT: "0" }), wallet(1)), { refused: "off" });
    assert.deepEqual(await ask(config({ FREE_MINT_SIGNER: "" }), wallet(1)), { refused: "off" });
    assert.deepEqual(await ask(config({ FREE_MINT_PAUSED: "1" }), wallet(1)), { refused: "paused" });
    assert.deepEqual(await ask(config(), wallet(1), "1.1.1.1", Date.parse("2026-12-09T00:00:00Z")), { refused: "closed" });
  });

  it("requires a full server match in the window", async () => {
    assert.deepEqual(await ask(config(), wallet(2)), { refused: "play-first" });
    await played(sql, wallet(2), { at: "2026-11-30T23:00:00Z" });
    assert.deepEqual(await ask(config(), wallet(2)), { refused: "play-first" }, "before the window");
    await played(sql, wallet(2), { turns: 3 });
    assert.deepEqual(await ask(config(), wallet(2)), { refused: "play-first" }, "too short");
    await played(sql, wallet(2), { turns: 8 });
    assert.ok("row" in (await ask(config(), wallet(2))));
  });

  it("is idempotent: repeated and concurrent claims return the same row", async () => {
    await played(sql, wallet(3));
    const results = await Promise.all(Array.from({ length: 6 }, () => ask(config(), wallet(3))));
    const rows = results.map((r) => ("row" in r ? r.row.id : r.refused));
    assert.equal(new Set(rows).size, 1);
    assert.equal(results.filter((r) => "row" in r && r.created).length, 1);
    const [count] = await sql<{ n: number }>`select count(*)::int as n from veil_free_mints`;
    assert.equal(Number(count!.n), 1);
  });

  it("enforces per-wallet, daily, budget and per-IP caps", async () => {
    for (let i = 10; i < 16; i++) await played(sql, wallet(i));
    const first = await ask(config(), wallet(10));
    assert.ok("row" in first);
    await sql`update veil_free_mints set status = 'delivered' where id = ${first.row.id}`;
    assert.deepEqual(await ask(config(), wallet(10)), { refused: "claimed" }, "one per wallet");
    assert.ok("row" in (await ask(config(), wallet(11), "2.2.2.2")));
    assert.ok("row" in (await ask(config(), wallet(12), "3.3.3.3")));
    assert.deepEqual(await ask(config(), wallet(13), "4.4.4.4"), { refused: "daily-cap" }, "3 a day");
    assert.deepEqual(await ask(config({ FREE_MINT_DAILY_CAP: "50", FREE_MINT_BUDGET_BZB: "3" }), wallet(13), "4.4.4.4"), { refused: "budget" }, "3 BzB spent");
    assert.deepEqual(await ask(config({ FREE_MINT_DAILY_CAP: "50", FREE_MINT_IP_DAILY: "1" }), wallet(13), "2.2.2.2"), { refused: "ip-cap" });
  });

  it("frees the slot when a claim failed", async () => {
    await played(sql, wallet(20));
    const first = await ask(config(), wallet(20));
    assert.ok("row" in first);
    await sql`update veil_free_mints set status = 'failed' where id = ${first.row.id}`;
    const second = await ask(config(), wallet(20));
    assert.ok("row" in second && second.created && second.row.n === 2);
  });

  it("honours the allowlist", async () => {
    await played(sql, wallet(30));
    const cfg = readFreeMintConfig(
      { FEATURE_FREE_MINT: "1", FREE_MINT_SIGNER: KEY, FREE_MINT_START: "2026-12-01T00:00:00Z", FREE_MINT_END: "2026-12-08T00:00:00Z", FREE_MINT_DAILY_CAP: "5", FREE_MINT_BUDGET_BZB: "5", FREE_MINT_ALLOWLIST: "x" },
      { readList: () => wallet(31) },
    );
    assert.deepEqual(await ask(cfg, wallet(30)), { refused: "not-allowed" });
  });
});

/** A fake chain that counts calls and can "crash" right after broadcasting. */
function fakeChain() {
  const calls = { buy: 0, settle: 0, transfer: [] as string[], approve: 0 };
  const txs = new Map<string, "success" | "reverted" | "pending">();
  let crashAfterHash: string | null = null;
  let block = 100n;
  let n = 0;
  const hash = (kind: string) => `0x${kind}${++n}`;
  const maybeCrash = (kind: string) => {
    if (crashAfterHash === kind) {
      crashAfterHash = null;
      throw new Error("process died");
    }
  };
  const chain: MintChain = {
    async ensureAllowance() {
      calls.approve++;
    },
    async buy(_pack, _faction, onHash) {
      calls.buy++;
      const h = hash("buy");
      txs.set(h, "success");
      await onHash(h);
      maybeCrash("buy");
      return { orderId: 7n, block };
    },
    async reservedFrom(_pack, h) {
      return txs.get(h) === "success" ? { state: "ok", orderId: 7n, block } : { state: "pending" };
    },
    async order() {
      return calls.settle ? { buyer: "0x0000000000000000000000000000000000000000", openedAt: 100n } : { buyer: "0xtreasury", openedAt: 100n };
    },
    async blockNumber() {
      return (block += 5n);
    },
    async settle(_pack, _orderId, onHash) {
      calls.settle++;
      const h = hash("settle");
      txs.set(h, "success");
      await onHash(h);
      maybeCrash("settle");
      return [3n, 3n, 9n, 12n, 40n];
    },
    async openedFrom(_pack, h) {
      return txs.get(h) === "success" ? { state: "ok", ids: [3n, 3n, 9n, 12n, 40n] } : { state: "pending" };
    },
    async findOpened() {
      return [3n, 3n, 9n, 12n, 40n];
    },
    async transfer(_nft, _to, id, amount, onHash) {
      calls.transfer.push(`${id}x${amount}`);
      const h = hash("tx");
      txs.set(h, "success");
      await onHash(h);
      maybeCrash(`transfer-${id}`);
    },
    async txState(h) {
      return txs.get(h) ?? "pending";
    },
  };
  return { chain, calls, crash: (kind: string) => (crashAfterHash = kind) };
}

describe("free mint worker", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => ({ sql, close } = await memoryDb()));
  after(async () => close());

  async function newClaim(): Promise<MintRow> {
    await sql`delete from veil_free_mints`;
    const rows = await sql<MintRow>`insert into veil_free_mints (id, wallet, window_id, n, edition, faction, price_wei) values (${newId()}, ${wallet(99)}, ${"w"}, ${1}, ${"core"}, ${0}, ${E18.toString()}) returning *`;
    return rows[0]!;
  }
  const load = async (id: string) => (await sql<MintRow>`select * from veil_free_mints where id = ${id}`)[0]!;

  it("buys, settles and delivers once, sending duplicate ids as one transfer", async () => {
    const { chain, calls } = fakeChain();
    const row = await newClaim();
    const done = await advanceClaim(sql, chain, config(), TARGETS, row);
    assert.equal(done.status, "delivered");
    assert.equal(calls.buy, 1);
    assert.equal(calls.settle, 1);
    assert.deepEqual(calls.transfer, ["3x2", "9x1", "12x1", "40x1"]);
    const again = await advanceClaim(sql, chain, config(), TARGETS, await load(row.id));
    assert.equal(again.status, "delivered");
    assert.equal(calls.buy, 1, "never buys twice");
    assert.equal(calls.transfer.length, 4, "never re-sends");
  });

  it("resumes after a crash right after the buy broadcast without buying again", async () => {
    const { chain, calls, crash } = fakeChain();
    const row = await newClaim();
    crash("buy");
    const mid = await advanceClaim(sql, chain, config(), TARGETS, row);
    assert.equal(mid.status, "buying");
    const done = await advanceClaim(sql, chain, config(), TARGETS, await load(row.id));
    assert.equal(done.status, "delivered");
    assert.equal(calls.buy, 1);
  });

  it("resumes after a crash mid-delivery without re-sending landed cards", async () => {
    const { chain, calls, crash } = fakeChain();
    const row = await newClaim();
    crash("transfer-9");
    const mid = await advanceClaim(sql, chain, config(), TARGETS, row);
    assert.equal(mid.status, "delivering");
    const done = await advanceClaim(sql, chain, config(), TARGETS, await load(row.id));
    assert.equal(done.status, "delivered");
    assert.deepEqual(calls.transfer, ["3x2", "9x1", "12x1", "40x1"]);
  });

  it("marks a claim failed when the treasury cannot pay, freeing the slot", async () => {
    const { chain } = fakeChain();
    chain.buy = async () => {
      throw new Error("ERC20: transfer amount exceeds balance");
    };
    const row = await newClaim();
    const out = await advanceClaim(sql, chain, config(), TARGETS, row);
    assert.equal(out.status, "failed");
  });

  it("the worker does nothing when the feature is off or stopped", async () => {
    const { chain, calls } = fakeChain();
    await newClaim();
    await runFreeMintWorker(sql, chain, config({ FEATURE_FREE_MINT: "0" }), TARGETS);
    await runFreeMintWorker(sql, chain, config({ FREE_MINT_PAUSED: "1" }), TARGETS);
    assert.equal(calls.buy, 0);
    await runFreeMintWorker(sql, chain, config(), TARGETS);
    assert.equal(calls.buy, 1);
  });
});
