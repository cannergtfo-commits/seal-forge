import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cardOf } from "./cards.ts";
import {
  assignDefenders,
  declareAttack,
  endTurn,
  playCard,
  startMatch,
  type Match,
  type Side,
  type Unit,
} from "./logic.ts";
import { guaranteedDamage, unitValue } from "./ai-hard.ts";

export function unit(m: Match, defId: string, owner: Side, extra: Partial<Unit> = {}): Unit {
  const card = cardOf(defId);
  m.seq += 1;
  return {
    uid: `t${m.seq}`,
    defId,
    owner,
    atk: card.atk,
    hp: card.hp,
    maxHp: card.hp,
    sick: false,
    ready: true,
    frozen: false,
    swing: 0,
    plating: card.plating ?? 0,
    plateLeft: card.plating ?? 0,
    ...extra,
  };
}

/** Seat `me` in its main phase on turn 9 with empty hands, boards and traps. */
export function board(me: Side = 0): Match {
  const m = startMatch("robot", "demon", 5);
  m.turn = me;
  m.turnCount = 9;
  m.phase = "main";
  for (const seat of m.players) {
    seat.hand = [];
    seat.units = [];
    seat.traps = [];
    seat.mana = 10;
    seat.manaMax = 10;
  }
  return m;
}

function cast(m: Match, defId: string, target: Parameters<typeof playCard>[2]): Match {
  m.players[m.turn].hand.push({ uid: `h${m.seq++}`, defId });
  const result = playCard(m, m.players[m.turn].hand.at(-1)!.uid, target);
  assert.equal(result.error, undefined);
  return result.state;
}

describe("Plating", () => {
  it("stops the first N damage each turn, then refills", () => {
    let m = board(0);
    const star = unit(m, "bz-quiet-star", 1);
    m.players[1].units = [star];
    m = cast(m, "shot", { kind: "unit", uid: star.uid });
    assert.equal(m.players[1].units[0]!.hp, 3);
    m = cast(m, "shot", { kind: "unit", uid: star.uid });
    assert.equal(m.players[1].units[0]!.hp, 1);
    m = endTurn(m).state;
    assert.equal(m.players[1].units[0]!.plateLeft, 1);
  });

  it("is counted before Crush spills over", () => {
    const m = board(0);
    const tyrant = unit(m, "tyrant", 0);
    const star = unit(m, "bz-quiet-star", 1);
    m.players[0].units = [tyrant];
    m.players[1].units = [star];
    const declared = declareAttack(m, [tyrant.uid]).state;
    const done = assignDefenders(declared, { [tyrant.uid]: star.uid }).state;
    assert.equal(done.players[1].units.length, 0);
    assert.equal(done.players[1].hp, 20 - 1);
  });

  it("is granted by APEX to other Quorin", () => {
    let m = board(0);
    m.players[0].units = [unit(m, "clock", 0)];
    m = cast(m, "apex", null);
    const clock = m.players[0].units.find((u) => u.defId === "clock")!;
    assert.equal(clock.plating, 1);
    assert.equal(clock.plateLeft, 1);
    assert.equal(clock.hp, 2);
  });

  it("is read by the AI as extra toughness", () => {
    const m = board(0);
    m.players[0].units = [unit(m, "lance", 0)];
    m.players[1].units = [unit(m, "core", 1)];
    assert.equal(guaranteedDamage(m, 0), 0);
    assert.ok(
      unitValue(m, m.players[1].units[0]!) >
        unitValue(m, unit(m, "core", 1, { plating: 0, plateLeft: 0 })) - 2,
    );
  });
});

describe("Requiem", () => {
  function killWith(defId: string, setup?: (m: Match) => void): Match {
    let m = board(0);
    const victim = unit(m, defId, 0, { hp: 1 });
    m.players[0].units = [victim];
    setup?.(m);
    m = cast(m, "grenade", { kind: "unit", uid: victim.uid });
    return m;
  }

  it("heals", () => {
    const m = killWith("bz-comet-fox", (x) => (x.players[0].hp = 10));
    assert.equal(m.players[0].hp, 12);
  });

  it("draws", () => {
    const m = killWith("un-choir");
    assert.equal(m.players[0].hand.length, 1);
  });

  it("pings the rival and can win the game", () => {
    const m = killWith("kg-ash-knight", (x) => (x.players[1].hp = 1));
    assert.equal(m.winner, 0);
  });

  it("can cost its owner life", () => {
    const m = killWith("as-tyrant-lilu", (x) => (x.players[0].hp = 10));
    assert.equal(m.players[0].hp, 7);
  });

  it("returns another Unbound card from the grave", () => {
    const m = killWith("bz-the-veil", (x) => {
      x.players[0].grave = ["shot", "un-toll", "bz-the-veil"];
    });
    assert.deepEqual(
      m.players[0].hand.map((h) => h.defId),
      ["un-toll"],
    );
    assert.ok(!m.players[0].grave.includes("un-toll"));
  });

  it("heals the most damaged ally", () => {
    const m = killWith("kg-plate-hood", (x) => {
      x.players[0].units.push(unit(x, "welder", 0, { hp: 1 }));
    });
    assert.equal(m.players[0].units.find((u) => u.defId === "welder")!.hp, 3);
  });
});
