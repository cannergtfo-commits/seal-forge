import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { actorOf, stepRival } from "./ai";
import { cardOf } from "./cards";
import { assignDefenders, canAttack, canBlock, declareAttack, endTurn, playCard, skipTrap, springTrap, type Match } from "./logic";
import {
  BANNED_COPY,
  INTERRUPTS,
  STEPS,
  TUTORIAL_KEY,
  currentStep,
  lessonCardsValid,
  setTutorialState,
  shouldOfferTutorial,
  tutorialCards,
  tutorialCopy,
  tutorialMatch,
  tutorialState,
} from "./tutorial-script";

function ok(r: { state: Match; error?: string }): Match {
  if (r.error) throw new Error(r.error);
  return r.state;
}

const uidOf = (m: Match, defId: string) => m.players[0].hand.find((c) => c.defId === defId)?.uid ?? null;

/** Does what the current coach step asks, like an attentive new player. */
function followCoach(m: Match, idx: number): Match {
  const step = STEPS[idx]?.id;
  const you = m.players[0];
  const play = (defId: string, target: Parameters<typeof playCard>[2] = null) => {
    const uid = uidOf(m, defId);
    return uid ? ok(playCard(m, uid, target, { tithe: false })) : null;
  };
  if (step === "play-unit") return play("scrap") ?? ok(endTurn(m));
  if (step === "surge") {
    if ((m.played ?? 0) === 0) return play("kg-quiet-hand") ?? play("familiar") ?? ok(endTurn(m));
    return play("twins") ?? ok(endTurn(m));
  }
  if (step === "trap-set") return play("pit") ?? ok(endTurn(m));
  if (step === "requiem") return play("as-road-sister") ?? ok(endTurn(m));
  if (step === "attack" || step === "attack-2") {
    const ids = you.units.filter((u) => canAttack(m, u)).map((u) => u.uid);
    return ids.length ? ok(declareAttack(m, ids)) : ok(endTurn(m));
  }
  if (step === "finish") {
    if (uidOf(m, "grenade") && you.mana >= 3) return play("grenade", { kind: "face", side: 1 })!;
    const ids = you.units.filter((u) => canAttack(m, u)).map((u) => u.uid);
    if (ids.length && !m.attacked) return ok(declareAttack(m, ids));
    const cheap = you.hand.find((c) => cardOf(c.defId).kind === "unit" && cardOf(c.defId).cost <= you.mana);
    if (cheap && you.units.length < 6) return ok(playCard(m, cheap.uid, null));
    return ok(endTurn(m));
  }
  return ok(endTurn(m));
}

function react(m: Match): Match {
  if (m.phase === "trap") {
    const trap = m.players[0].traps[0];
    const target = m.attackers[0];
    if (trap && target) {
      const sprung = springTrap(m, trap.uid, target);
      if (!sprung.error) return sprung.state;
    }
    return ok(skipTrap(m));
  }
  const blocker = m.players[0].units.find((u) => canBlock(u));
  const blocks = Object.fromEntries(m.attackers.map((id, i) => [id, i === 0 && blocker ? blocker.uid : null]));
  const r = assignDefenders(m, blocks);
  return r.error ? ok(assignDefenders(m, {})) : r.state;
}

function run(): { m: Match; seen: string[]; skipped: string[]; interrupts: string[] } {
  let m = tutorialMatch();
  let idx = 0;
  const acked = new Set<string>();
  const seen: string[] = [];
  const skipped: string[] = [];
  const interrupts = new Set<string>();
  for (let guard = 0; guard < 400 && m.winner === null; guard++) {
    const before = idx;
    idx = currentStep(m, idx, acked);
    for (let i = before; i < idx; i++) if (STEPS[i]!.skip?.(m) && !seen.includes(STEPS[i]!.id)) skipped.push(STEPS[i]!.id);
    const step = STEPS[idx];
    if (step && !seen.includes(step.id) && (step.show?.(m) ?? true)) seen.push(step.id);
    if (step?.next) {
      acked.add(step.id);
      continue;
    }
    for (const item of INTERRUPTS) if (item.show(m)) interrupts.add(item.id);
    const actor = actorOf(m);
    if (actor === 1) {
      m = stepRival(m, "easy") ?? m;
      continue;
    }
    if (m.phase === "trap" || m.phase === "defend") {
      m = react(m);
      continue;
    }
    m = followCoach(m, idx);
  }
  idx = currentStep(m, idx, acked);
  return { m, seen, skipped, interrupts: [...interrupts] };
}

describe("Guided first match", () => {
  it("uses real cards that still carry the keywords the lessons teach", () => {
    for (const id of tutorialCards()) assert.ok(cardOf(id), id);
    assert.ok(lessonCardsValid());
  });

  it("is the same match every time", () => {
    assert.deepEqual(tutorialMatch(), tutorialMatch());
    const m = tutorialMatch();
    assert.deepEqual(
      m.players[0].hand.map((c) => c.defId),
      ["scrap", "kg-quiet-hand", "pit", "familiar"],
    );
    assert.equal(m.turn, 0);
    assert.equal(m.players[0].mana, 1);
  });

  it("an attentive player sees every lesson and wins in a few turns", () => {
    const { m, seen, skipped, interrupts } = run();
    assert.equal(m.winner, 0, `winner ${m.winner}, log: ${m.log.join(" | ")}`);
    assert.ok(m.turnCount <= 11, `took ${m.turnCount} turns`);
    for (const id of ["welcome", "mana", "play-unit", "attack", "surge", "plating", "trap-set", "requiem", "finish"]) {
      assert.ok(seen.includes(id), `missed ${id}; seen ${seen.join(",")}; skipped ${skipped.join(",")}`);
    }
    assert.deepEqual(skipped, [], `skipped ${skipped.join(",")}`);
    assert.ok(interrupts.includes("block"), "the rival should attack into a block lesson");
    assert.ok(interrupts.includes("trap"), "the rival should attack into the set trap");
  });

  it("a player who only ends turns still reaches the end (steps skip, nothing hangs)", () => {
    let m = tutorialMatch();
    let idx = 0;
    const acked = new Set(STEPS.filter((s) => s.next).map((s) => s.id));
    for (let guard = 0; guard < 600 && m.winner === null; guard++) {
      idx = currentStep(m, idx, acked);
      if (actorOf(m) === 1) m = stepRival(m, "easy") ?? m;
      else if (m.phase === "trap") m = ok(skipTrap(m));
      else if (m.phase === "defend") m = ok(assignDefenders(m, {}));
      else m = ok(endTurn(m));
    }
    assert.notEqual(m.winner, null, "the match must end");
    assert.ok(currentStep(m, idx, acked) >= STEPS.findIndex((s) => s.id === "finish"));
  });

  it("never mentions wallets, tokens or prizes", () => {
    for (const line of tutorialCopy()) assert.doesNotMatch(line, BANNED_COPY, line);
  });

  it("stores completion locally and stops offering itself", () => {
    const mem = new Map<string, string>();
    const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    assert.equal(shouldOfferTutorial(s), true);
    setTutorialState("dismissed", s);
    assert.equal(shouldOfferTutorial(s), false);
    setTutorialState("done", s);
    setTutorialState("skipped", s);
    assert.equal(tutorialState(s), "done");
    assert.equal(mem.get(TUTORIAL_KEY), "done");
  });
});
