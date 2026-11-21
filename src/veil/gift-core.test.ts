import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GiftPending, giftErrorText, pickOrphanOrder, pollReceipt, polygonRpcUrls, type KeeperOrder } from "./gift-core.ts";

const KEEPER = "0x80f59AEa437654AA3F6AA449248311264e2Bf81d" as const;
const OTHER = "0x00000000000000000000000000000000000000aa" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const PRICE = 10n ** 18n;

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("gift rpc list", () => {
  it("puts SEAL_FORGE_RPC first, keeps publicnode last, drops dead and non-https urls", () => {
    const urls = polygonRpcUrls({ SEAL_FORGE_RPC: "https://my.node/rpc, http://insecure.example, https://1rpc.io/matic" });
    assert.equal(urls[0], "https://my.node/rpc");
    assert.equal(urls.at(-1), "https://polygon-bor-rpc.publicnode.com");
    assert.ok(!urls.includes("http://insecure.example"));
    assert.ok(!urls.includes("https://polygon-rpc.com"));
    assert.equal(new Set(urls).size, urls.length, "no duplicates");
    assert.ok(polygonRpcUrls({}).length >= 3, "several public fallbacks with no env");
  });
});

describe("pollReceipt", () => {
  it("keeps polling through RPC errors (publicnode 'archive' 403) and not-found, then returns the receipt", async () => {
    const c = clock();
    const answers: Array<() => { status: "success" | "reverted" } | null> = [
      () => {
        throw new Error("Invalid parameters were provided to the RPC method. Details: Archive requests require a personal token.");
      },
      () => null,
      () => {
        throw new Error("Transaction receipt with hash 0x… could not be found.");
      },
      () => ({ status: "success" }),
    ];
    let calls = 0;
    const receipt = await pollReceipt(async () => answers[calls++]!(), { timeoutMs: 60_000, intervalMs: 1_000, ...c });
    assert.deepEqual(receipt, { status: "success" });
    assert.equal(calls, 4);
  });

  it("returns a reverted receipt as-is (only a mined revert is a failure)", async () => {
    const receipt = await pollReceipt(async () => ({ status: "reverted" as const }), { timeoutMs: 1_000, ...clock() });
    assert.equal(receipt?.status, "reverted");
  });

  it("returns null (still pending) at the deadline instead of throwing", async () => {
    const c = clock();
    const receipt = await pollReceipt(async () => {
      throw new Error("HTTP request failed. Status: 403");
    }, { timeoutMs: 10_000, intervalMs: 2_000, ...c });
    assert.equal(receipt, null);
    assert.ok(c.now() >= 10_000);
  });
});

describe("pickOrphanOrder", () => {
  const orders: KeeperOrder[] = [
    { id: 57n, buyer: KEEPER, faction: 0, price: PRICE },
    { id: 58n, buyer: OTHER, faction: 0, price: PRICE },
    { id: 59n, buyer: KEEPER, faction: 0, price: PRICE },
    { id: 60n, buyer: KEEPER, faction: 2, price: PRICE },
    { id: 61n, buyer: KEEPER, faction: 0, price: 5n * PRICE },
  ];

  it("recovers the newest keeper Founding order at the gift price that nobody owns (the stuck order 59 case)", () => {
    const owed = new Map<bigint, `0x${string}`>([[57n, ZERO], [59n, ZERO]]);
    assert.equal(pickOrphanOrder(orders, owed, { keeper: KEEPER, price: PRICE, recorded: new Set() }), 59n);
  });

  it("skips orders already owed to a player or recorded on any profile", () => {
    const owed = new Map<bigint, `0x${string}`>([[57n, ZERO], [59n, OTHER]]);
    assert.equal(pickOrphanOrder(orders, owed, { keeper: KEEPER, price: PRICE, recorded: new Set() }), 57n);
    assert.equal(pickOrphanOrder(orders, new Map([[57n, ZERO], [59n, ZERO]]), { keeper: KEEPER, price: PRICE, recorded: new Set(["57", "59"]) }), null);
  });

  it("never picks another buyer's order, another faction, or another price", () => {
    const only = orders.filter((order) => order.id !== 57n && order.id !== 59n);
    assert.equal(pickOrphanOrder(only, new Map(), { keeper: KEEPER, price: PRICE, recorded: new Set() }), null);
  });
});

describe("giftErrorText", () => {
  it("hides raw RPC dumps behind a retry line", () => {
    const raw = 'Invalid parameters were provided to the RPC method.\nURL: https://polygon-bor-rpc.publicnode.com\nRequest body: {"method":"eth_getTransactionReceipt"}';
    const text = giftErrorText(new Error(raw));
    assert.match(text, /Claim again/);
    assert.doesNotMatch(text, /publicnode|Request body/);
  });
  it("explains an empty gift pool", () => {
    assert.match(giftErrorText(new Error('reverted with custom error "Empty()"')), /empty/i);
  });
  it("passes a pending note through", () => {
    assert.match(giftErrorText(new GiftPending()), /still confirming/);
  });
});
