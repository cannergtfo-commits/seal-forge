import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cardOf } from "./cards.ts";
import {
  assignDefenders,
  declareAttack,
  endTurn,
  canAttack,
  canTarget,
  playCard,
  power,
  skipTrap,
  springTrap,
  startMatch,
  titheSafe,
  type Match,
  type Side,
  type Unit,
} from "./logic.ts";
import { guaranteedDamage, unitValue } from "./ai-hard.ts";
import { stepRival } from "./ai.ts";

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

function cast(
  m: Match,
  defId: string,
  target: Parameters<typeof playCard>[2],
  options?: Parameters<typeof playCard>[3],
): Match {
  m.players[m.turn].hand.push({ uid: `h${m.seq++}`, defId });
  const result = playCard(m, m.players[m.turn].hand.at(-1)!.uid, target, options);
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

describe("Surge", () => {
  it("does nothing on the first card of the turn and fires after another card", () => {
    let m = board(0);
    m.played = 0;
    m = cast(m, "twins", null);
    assert.equal(m.players[0].units[0]!.atk, 1);
    m = cast(m, "kg-twin-stars", null);
    assert.equal(m.players[0].units[1]!.atk, 2);
    assert.equal(m.players[0].units[1]!.hp, 2);
  });

  it("can give Haste, buff a spell's target, ping or draw", () => {
    let m = board(0);
    m.played = 1;
    m = cast(m, "bz-twin-jets", null);
    assert.equal(m.players[0].units[0]!.sick, false);
    const jets = m.players[0].units[0]!;
    m = cast(m, "charge", { kind: "unit", uid: jets.uid });
    const pumped = m.players[0].units[0]!;
    assert.equal(pumped.swing, 2);
    assert.equal(pumped.hp, 3, "no self-hit, and Surge adds +0/+2");
    m = cast(m, "grenade", { kind: "face", side: 1 });
    assert.equal(m.players[1].hp, 20 - 3 - 1);
    const hand = m.players[0].hand.length;
    m = cast(m, "kg-horde-star", { kind: "face", side: 1 });
    assert.equal(m.players[0].hand.length, hand + 1);
  });

  it("resets each turn", () => {
    let m = board(0);
    m.played = 3;
    m = endTurn(m).state;
    assert.equal(m.played, 0);
  });

  it("is sequenced by Hard: the cheap card goes first", () => {
    const m = board(0);
    m.players[0].mana = 3;
    m.players[0].hand = [
      { uid: "s", defId: "bz-eclipse-blade" },
      { uid: "c", defId: "scrap" },
    ];
    const first = stepRival(m, "hard", 0)!;
    assert.ok(
      first.players[0].units.some((u) => u.defId === "scrap"),
      "Hard should play the 1-drop first",
    );
    const second = stepRival(first, "hard", 0)!;
    const blade = second.players[0].units.find((u) => u.defId === "bz-eclipse-blade");
    assert.ok(blade && blade.atk === 2 && !blade.sick, "then the Surge card, which surges");
  });
});

describe("Bloom", () => {
  it("grows on every heal, including drain and ally heals", () => {
    let m = board(0);
    m.players[0].hp = 10;
    m.players[0].units = [unit(m, "moonpetal", 0), unit(m, "scrap", 0, { hp: 1, maxHp: 2 })];
    m = cast(m, "mend", null);
    assert.equal(m.players[0].units[0]!.atk, 2);
    const scrap = m.players[0].units[1]!;
    m = cast(m, "medic", { kind: "unit", uid: scrap.uid });
    assert.equal(m.players[0].units[0]!.atk, 3);
  });

  it("counts its own Play heal", () => {
    let m = board(0);
    m = cast(m, "bz-lysara-blazar", null);
    assert.equal(m.players[0].units[0]!.atk, 5);
  });

  it("lets the Bloom heal spells draw", () => {
    let m = board(0);
    m.players[0].deck = ["scrap", "scrap"];
    m = cast(m, "bz-moon-well", null);
    assert.equal(m.players[0].hand.length, 0);
    m.players[0].units = [unit(m, "moonpetal", 0)];
    m = cast(m, "kg-quiet-mend", null);
    assert.equal(m.players[0].hand.length, 1);
  });
});

describe("Formation", () => {
  it("turns on at 3 units for attack and health", () => {
    let m = board(0);
    m = cast(m, "un-squire", null);
    m = cast(m, "scrap", null);
    const squire = () => m.players[0].units.find((u) => u.defId === "un-squire")!;
    assert.equal(power(m, squire()), 2);
    assert.equal(squire().hp, 2);
    m = cast(m, "scrap", null);
    assert.equal(power(m, squire()), 3);
    assert.equal(squire().hp, 3);
  });

  it("turns off when the board drops below 3, without killing the unit", () => {
    let m = board(0);
    const squire = unit(m, "un-squire", 1, { hp: 3, maxHp: 3, formed: true });
    const scrap = unit(m, "scrap", 1);
    m.players[1].units = [squire, scrap, unit(m, "scrap", 1)];
    m = cast(m, "un-toll", { kind: "unit", uid: squire.uid });
    assert.equal(m.players[1].units[0]!.hp, 1);
    m = cast(m, "un-toll", { kind: "unit", uid: scrap.uid });
    const after = m.players[1].units.find((u) => u.defId === "un-squire");
    assert.ok(after, "losing Formation never kills");
    assert.equal(after.hp, 1);
    assert.equal(after.maxHp, 2);
    assert.equal(after.formed, false);
    assert.equal(power(m, after), 2);
  });

  it("gets +1 health from Rally", () => {
    let m = board(0);
    m.players[0].units = [unit(m, "un-squire", 0), unit(m, "scrap", 0)];
    m = cast(m, "rally", null);
    const [squire, scrap] = m.players[0].units;
    assert.equal(squire!.hp, 3);
    assert.equal(scrap!.hp, 1);
    assert.equal(squire!.swing, 1);
  });
});

describe("Tithe", () => {
  it("pays life for the extra effect when asked", () => {
    let m = board(0);
    m.players[0].deck = ["scrap", "scrap", "scrap"];
    m = cast(m, "pact", null, { tithe: true });
    assert.equal(m.players[0].hand.length, 2);
    assert.equal(m.players[0].hp, 18);
  });

  it("can be declined", () => {
    let m = board(0);
    m.players[0].deck = ["scrap", "scrap", "scrap"];
    m = cast(m, "pact", null, { tithe: false });
    assert.equal(m.players[0].hand.length, 1);
    assert.equal(m.players[0].hp, 20);
  });

  it("can't be paid at or below N life", () => {
    let m = board(0);
    m.players[0].hp = 3;
    m = cast(m, "bz-tyrant-blazar", null, { tithe: true });
    assert.equal(m.players[0].hp, 3);
    assert.equal(m.players[0].units[0]!.atk, 5);
  });

  it("grants keywords that work in combat", () => {
    let m = board(0);
    m = cast(m, "kg-duchess-kage", null, { tithe: true });
    assert.equal(m.players[0].hp, 18);
    const duchess = m.players[0].units[0]!;
    duchess.sick = false;
    const declared = declareAttack(m, [duchess.uid]).state;
    const done = assignDefenders(declared, {}).state;
    assert.equal(done.players[1].hp, 16);
    assert.equal(done.players[0].hp, 22);
  });

  it("defaults to the safe-pay rule when no choice is given", () => {
    const m = board(0);
    assert.equal(titheSafe(m, 0, 3), true);
    m.players[1].units = [unit(m, "tyrant", 1)];
    m.players[0].hp = 12;
    assert.equal(titheSafe(m, 0, 3), false);
    const after = cast(m, "bz-tyrant-blazar", null);
    assert.equal(after.players[0].hp, 12);
  });

  it("is paid by Hard when life is safe and skipped when it is not", () => {
    const rich = board(0);
    rich.players[0].mana = 7;
    rich.players[0].deck = ["scrap", "scrap", "scrap"];
    rich.players[0].hand = [{ uid: "v", defId: "kg-veil-kage" }];
    const paid = stepRival(rich, "hard", 0)!;
    assert.equal(paid.players[0].hp, 17);
    assert.equal(paid.players[0].hand.length, 2);

    const poor = board(0);
    poor.players[0].mana = 7;
    poor.players[0].hp = 6;
    poor.players[1].units = [unit(poor, "lance", 1)];
    poor.players[0].deck = ["scrap", "scrap", "scrap"];
    poor.players[0].hand = [{ uid: "v", defId: "kg-veil-kage" }];
    const kept = stepRival(poor, "hard", 0)!;
    assert.equal(kept.players[0].hp, 6);
  });
});

describe("Veilstep", () => {
  it("can't be targeted by the rival's spells until it has attacked", () => {
    const m = board(0);
    const pilgrim = unit(m, "un-pilgrim", 1);
    m.players[1].units = [pilgrim];
    m.players[0].hand = [{ uid: "s", defId: "shot" }];
    const tried = playCard(m, "s", { kind: "unit", uid: pilgrim.uid });
    assert.match(tried.error ?? "", /Veilstep/);
    assert.equal(canTarget(m, 1, pilgrim), true, "its owner can still target it");
  });

  it("can't be hit by traps on its first attack, and is revealed after", () => {
    let m = board(0);
    const pilgrim = unit(m, "un-pilgrim", 0);
    m.players[0].units = [pilgrim];
    m.players[1].traps = [{ uid: "t", defId: "un-cross", owner: 1 }];
    m = declareAttack(m, [pilgrim.uid]).state;
    assert.equal(m.phase, "trap");
    assert.match(springTrap(m, "t", pilgrim.uid).error ?? "", /Veilstep/);
    m = skipTrapState(m);
    m = assignDefenders(m, {}).state;
    assert.equal(m.players[1].hp, 18);
    const after = m.players[0].units[0]!;
    assert.equal(after.revealed, true);
    assert.equal(canTarget(m, 1, after), true);
  });

  it("is respected by the AI's targeting", () => {
    const m = board(0);
    m.players[1].units = [unit(m, "kg-pilgrim-kage", 1)];
    m.players[0].hand = [{ uid: "s", defId: "shot" }];
    const next = stepRival(m, "hard", 0);
    assert.equal(next?.players[1].units.length, 1);
    const normal = stepRival(m, "guard", 0);
    assert.equal(normal?.players[1].units.length, 1);
  });
});

describe("Unseal", () => {
  it("strips keywords, abilities and buffs; damage stays", () => {
    let m = board(0);
    const tyrant = unit(m, "tyrant", 1, { atk: 8, hp: 5, maxHp: 8, granted: ["drain"] });
    m.players[1].units = [tyrant];
    m = cast(m, "as-silver-toll", { kind: "unit", uid: tyrant.uid });
    const t = m.players[1].units[0]!;
    assert.equal(t.silenced, true);
    assert.equal(t.atk, cardOf("tyrant").atk);
    assert.equal(t.maxHp, cardOf("tyrant").hp);
    assert.equal(t.hp, 5);
    assert.deepEqual(t.granted, []);
  });

  it("turns off Requiem, Plating, auras and Can't attack", () => {
    let m = board(0);
    const choir = unit(m, "un-choir", 1, { hp: 1 });
    const star = unit(m, "bz-quiet-star", 1);
    m.players[1].units = [choir, star];
    m.players[1].deck = ["scrap"];
    m = cast(m, "as-silver-toll", { kind: "unit", uid: choir.uid });
    m = cast(m, "shot", { kind: "unit", uid: choir.uid });
    assert.equal(m.players[1].hand.length, 0, "no Requiem draw");
    m = cast(m, "as-silver-toll", { kind: "unit", uid: star.uid });
    m = cast(m, "shot", { kind: "unit", uid: star.uid });
    assert.equal(m.players[1].units[0]!.hp, 2, "no Plating");

    let n = board(0);
    const core = unit(n, "core", 0, { sick: false });
    n.players[0].units = [core];
    n = cast(n, "as-silver-toll", { kind: "unit", uid: core.uid });
    assert.equal(canAttack(n, n.players[0].units[0]!), false, "0 attack still can't swing");
  });

  it("freezes an enemy with Petal Cut, and The Nameless may enter with no target", () => {
    let m = board(0);
    const lance = unit(m, "lance", 1);
    m.players[1].units = [lance];
    m = cast(m, "kg-petal-cut", { kind: "unit", uid: lance.uid });
    assert.equal(m.players[1].units[0]!.frozen, true);
    const empty = cast(board(0), "un-nameless", null);
    assert.equal(empty.players[0].units.length, 1);
  });

  it("is aimed by Normal at the unit with the most to lose", () => {
    const m = board(0);
    m.players[0].mana = 2;
    m.players[1].units = [unit(m, "scrap", 1), unit(m, "tyrant", 1)];
    m.players[0].hand = [{ uid: "u", defId: "as-silver-toll" }];
    const next = stepRival(m, "guard", 0)!;
    const tyrant = next.players[1].units.find((u) => u.defId === "tyrant")!;
    assert.equal(tyrant.silenced, true);
  });
});

function skipTrapState(m: Match): Match {
  return skipTrap(m).state;
}
