import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { actorOf, settle, stepRival } from "./ai.ts";
import { guaranteedDamage, lethalStep } from "./ai-hard.ts";
import { levelOf, type BotStyle } from "./bots.ts";
import { cardOf } from "./cards.ts";
import { startMatch, type Match, type Side, type Unit } from "./logic.ts";

function unit(m: Match, defId: string, owner: Side, extra: Partial<Unit> = {}): Unit {
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
    ...extra,
  };
}

/** A mid-game board where seat `me` is in its main phase. */
function board(me: Side): Match {
  const m = startMatch("goblin", "robot", 3);
  m.turn = me;
  m.turnCount = 9;
  m.phase = "main";
  m.attacked = false;
  for (const seat of m.players) {
    seat.hand = [];
    seat.units = [];
    seat.traps = [];
    seat.mana = 5;
    seat.manaMax = 5;
  }
  return m;
}

function mirror(m: Match): Match {
  const x = structuredClone(m);
  x.players = [x.players[1], x.players[0]];
  for (const seat of x.players) {
    for (const u of seat.units) u.owner = (1 - u.owner) as Side;
    for (const t of seat.traps) t.owner = (1 - t.owner) as Side;
  }
  x.turn = (1 - x.turn) as Side;
  if (x.winner !== null) x.winner = (1 - x.winner) as Side;
  return x;
}

function strip(m: Match) {
  return { ...m, log: [] };
}

describe("AI levels", () => {
  it("map the original styles", () => {
    assert.equal(levelOf("easy"), "easy");
    assert.equal(levelOf("guard"), "normal");
    assert.equal(levelOf("aggro"), "normal");
    assert.equal(levelOf("hard"), "hard");
  });

  it("make the same decision from either seat", () => {
    for (const style of ["easy", "guard", "aggro", "hard"] as BotStyle[]) {
      let m = startMatch("elf", "demon", 11);
      for (let i = 0; i < 400 && m.winner === null; i++) {
        const actor = actorOf(m);
        const next = stepRival(m, style, actor);
        assert.ok(next, `${style} stalled`);
        const mirrored = stepRival(mirror(m), style, (1 - actor) as Side);
        assert.ok(mirrored);
        assert.deepEqual(strip(mirror(mirrored)), strip(next), `${style} step ${i}`);
        m = next;
      }
      assert.notEqual(m.winner, null, `${style} game should finish`);
    }
  });

  it("only act for their own seat", () => {
    const m = board(0);
    assert.equal(stepRival(m, "hard", 1), null);
    assert.ok(stepRival(m, "hard", 0));
  });
});

describe("Hard", () => {
  it("burns the face for lethal through a wall of blockers", () => {
    const m = board(1);
    m.players[0].hp = 5;
    m.players[0].units = [unit(m, "core", 0), unit(m, "sentry", 0)];
    m.players[1].units = [unit(m, "scrap", 1)];
    m.players[1].hand = [
      { uid: "h1", defId: "shot" },
      { uid: "h2", defId: "spark" },
      { uid: "h3", defId: "raider" },
    ];
    const plan = lethalStep(m, 1);
    assert.ok(plan && plan !== "attack");
    const done = settle(m, "hard", 1);
    assert.equal(done.winner, 1);
  });

  it("counts burn plus unblockable attackers", () => {
    const m = board(1);
    m.players[0].hp = 7;
    m.players[0].units = [unit(m, "clock", 0)];
    m.players[1].units = [unit(m, "boom", 1), unit(m, "raider", 1)];
    m.players[1].hand = [{ uid: "h1", defId: "grenade" }];
    m.players[1].mana = 4;
    assert.equal(guaranteedDamage(m, 1), 2);
    const plan = lethalStep(m, 1);
    assert.ok(plan === null || plan !== "attack");
    const first = stepRival(m, "hard", 1)!;
    const hit = first.players[0].hp < 7 || first.players[0].units.length === 0;
    assert.ok(hit, "it should use the grenade first");
  });

  it("does not attack a small unit into a big untapped blocker", () => {
    const m = board(1);
    m.players[0].units = [unit(m, "apex", 0)];
    m.players[1].units = [unit(m, "scrap", 1)];
    const next = stepRival(m, "hard", 1)!;
    assert.equal(next.attackers.length, 0);
  });

  it("keeps a blocker home when swinging would leave it dead on board", () => {
    const m = board(1);
    m.players[1].hp = 5;
    m.players[0].hp = 20;
    // Their units swung last turn, so they can't block now, but all three swing back next turn.
    m.players[0].units = [
      unit(m, "lance", 0, { ready: false }),
      unit(m, "blood-knight", 0, { ready: false }),
      unit(m, "raider", 0, { ready: false }),
    ];
    m.players[1].units = [unit(m, "core", 1), unit(m, "oath-knight", 1)];
    m.players[1].mana = 0;
    const next = settle(m, "hard", 1);
    const knight = next.players[1].units.find((u) => u.defId === "oath-knight");
    assert.ok(knight && knight.ready, "the knight should stay back to block");
  });

  it("blocks to survive lethal", () => {
    const m = board(0);
    m.players[1].hp = 4;
    m.players[0].units = [unit(m, "blood-knight", 0)];
    m.players[1].units = [unit(m, "sentry", 1)];
    const declared = stepRival(m, "guard", 0)!;
    assert.equal(declared.phase, "defend");
    const blocked = stepRival(declared, "hard", 1)!;
    assert.ok(blocked.players[1].hp > 0);
  });

  it("springs a snare on a small attacker it cannot block", () => {
    const m = board(0);
    m.players[1].hp = 3;
    m.players[0].units = [unit(m, "scrap", 0)];
    m.players[1].traps = [{ uid: "tr", defId: "pit", owner: 1 }];
    const declared = stepRival(m, "aggro", 0)!;
    assert.equal(declared.phase, "trap");
    const sprung = stepRival(declared, "hard", 1)!;
    assert.equal(sprung.players[1].traps.length, 0);
    assert.equal(sprung.players[0].units.length, 0);
  });
});
