/*
 * The Hard bot.
 *
 * It plays fair: it reads only public information about the rival (board, life,
 * ward, hand size, deck size, and how many traps are face down, never which
 * ones). It simulates candidate actions with the real rules engine on copies of
 * the match and keeps the one with the best evaluation.
 *
 * - Main phase:
 *   1. Lethal search: every affordable mix of burn, buffs, haste enablers and
 *      haste units, checked against the rival's best possible blocks and one
 *      unknown trap. Burn to the face counts.
 *   2. Otherwise, the single play (card and target) that most improves the
 *      evaluation, including plays that set up a better attack.
 *   3. Then the best attack, comparing several attacker sets after the rival's
 *      predicted blocks, the trap risk, and how exposed it leaves us.
 * - Trap window: spring the trap and target that leave the best position after
 *   blocks, or keep the trap down.
 * - Blocks: start from the Normal plan, then improve it by local search.
 */
import { cardOf, needsTarget, type CardDef } from "./cards";
import { KEYWORDS } from "./keywords";
import {
  assignDefenders,
  attackTraps,
  canAttack,
  canBlock,
  declareAttack,
  endTurn,
  findUnit,
  other,
  playCard,
  power,
  skipTrap,
  springTrap,
  surgeActive,
  toughness,
  type Match,
  type Side,
  type Target,
  type Unit,
} from "./logic";
import { normalBlocks, sharpAttackers } from "./ai";

const WIN = 100000;

/** Concave value of life: the last points matter most. */
function lifeValue(hp: number): number {
  if (hp <= 0) return -WIN;
  return 12 * Math.log(1 + hp / 4);
}

function keywordValue(card: CardDef): number {
  let value = 0;
  for (const tag of card.tags) value += KEYWORDS[tag].aiValue;
  if (card.noAttack) value += KEYWORDS.noAttack.aiValue;
  if (card.aura) value += 2;
  if (card.plating) value += card.plating * KEYWORDS.plating.aiValue;
  value += requiemValue(card);
  return value;
}

/** What a unit's Requiem is worth when it dies, in stat points. */
export function requiemValue(card: CardDef): number {
  const effect = card.requiem;
  if (!effect) return 0;
  if (effect.t === "heal") return effect.n * 0.4;
  if (effect.t === "draw") return effect.n * 1.6;
  if (effect.t === "ping") return effect.n * 0.6;
  if (effect.t === "lose") return -effect.n * 0.5;
  if (effect.t === "healAlly") return effect.n * 0.4;
  return 1.6;
}

/** Rough value of a card's Surge bonus, in stat points. */
export function surgeValue(card: CardDef): number {
  const effect = card.surge;
  if (!effect) return 0;
  if (effect.t === "self") return effect.a * 1.05 + effect.h * 0.8 + (effect.haste ? 1.5 : 0);
  if (effect.t === "target") return effect.a * 1.05 + effect.h * 0.8;
  if (effect.t === "ping") return effect.n * 0.6;
  return effect.n * 1.6;
}

/** True when another card can be played first and this one still fits in the mana left. */
function waitsForSurge(m: Match, me: Side, uid: string, card: CardDef): boolean {
  const mana = m.players[me].mana;
  return playable(m, me).some((item) => item.uid !== uid && item.card.cost + card.cost <= mana);
}

/** Lasting board value of a unit. Ignores this-turn swing. */
export function unitValue(m: Match, unit: Unit): number {
  const card = cardOf(unit.defId);
  const atk = card.noAttack ? 0 : Math.max(0, power(m, unit) - unit.swing);
  const granted = Math.max(0, (unit.plating ?? 0) - (card.plating ?? 0));
  let value =
    0.6 +
    atk * 1.05 +
    Math.max(0, unit.hp) * 0.8 +
    keywordValue(card) +
    granted * KEYWORDS.plating.aiValue;
  if (unit.frozen) value -= atk * 0.4;
  return value;
}

function handValue(count: number): number {
  return count * 1.6;
}

/** Damage `side`'s rival can push next turn past `side`'s available blockers. */
function exposure(m: Match, side: Side): number {
  const foe = other(side);
  const threats = m.players[foe].units
    .filter((unit) => !unit.frozen && !cardOf(unit.defId).noAttack)
    .map((unit) => Math.max(0, unit.atk))
    .sort((a, b) => b - a);
  const blockers = m.players[side].units.filter((unit) => canBlock(unit)).length;
  return threats.slice(blockers).reduce((sum, value) => sum + value, 0);
}

/**
 * How good the match is for `me`. `next` is the seat that attacks next, whose
 * rival is the one exposed.
 */
export function evaluate(m: Match, me: Side, next: Side = other(me)): number {
  if (m.winner === me) return WIN;
  if (m.winner === other(me)) return -WIN;
  const foe = other(me);
  const mine = m.players[me];
  const theirs = m.players[foe];
  const aggressive = theirs.hp <= 10 || boardPower(m, me) >= boardPower(m, foe) + 3;
  let score = 0;
  const exposed = next === foe ? exposure(m, me) : 0;
  const myHp = mine.hp + mine.ward * 0.8 - exposed * 0.6;
  score += exposed >= mine.hp + mine.ward ? -60 : 0;
  score += lifeValue(myHp);
  const theirExposed = next === me ? exposure(m, foe) : 0;
  // When pressing, the life they have already lost counts 25% more. (Scaling their whole life
  // total instead would punish getting ahead on board.)
  const theirLife = lifeValue(theirs.hp + theirs.ward * 0.8 - theirExposed * 0.4);
  score -= theirLife + (aggressive ? 0.25 * Math.min(0, theirLife - lifeValue(20)) : 0);
  for (const unit of mine.units) score += unitValue(m, unit);
  for (const unit of theirs.units) score -= unitValue(m, unit);
  score += handValue(mine.hand.length) - handValue(theirs.hand.length);
  score += mine.traps.reduce((sum, trap) => sum + 1.2 + cardOf(trap.defId).cost * 0.5, 0);
  score -= theirs.traps.length * 2;
  if (mine.deck.length === 0) score -= 3;
  return score;
}

function boardPower(m: Match, side: Side): number {
  return m.players[side].units.reduce((sum, unit) => sum + power(m, unit), 0);
}

/** Every legal target for a card, from the rules' point of view. */
export function targetsFor(m: Match, me: Side, card: CardDef): (Target | null)[] {
  if (!needsTarget(card)) return [null];
  const foe = other(me);
  const t = card.play?.t;
  const mine = m.players[me].units;
  const theirs = m.players[foe].units;
  if (t === "hit")
    return [
      { kind: "face", side: foe },
      ...[...theirs, ...mine].map((unit) => ({ kind: "unit" as const, uid: unit.uid })),
    ];
  if (t === "freeze") return theirs.map((unit) => ({ kind: "unit" as const, uid: unit.uid }));
  if (t === "overclock")
    return mine
      .filter((unit) => cardOf(unit.defId).faction === "robot")
      .map((unit) => ({ kind: "unit" as const, uid: unit.uid }));
  return mine.map((unit) => ({ kind: "unit" as const, uid: unit.uid }));
}

function playable(m: Match, me: Side): { uid: string; card: CardDef }[] {
  const seat = m.players[me];
  return seat.hand
    .map((hand) => ({ uid: hand.uid, card: cardOf(hand.defId) }))
    .filter(({ card }) => card.cost <= seat.mana)
    .filter(({ card }) => (card.kind === "unit" ? seat.units.length < 6 : true))
    .filter(({ card }) => (card.kind === "trap" ? seat.traps.length < 3 : true));
}

/** Damage the rival can't stop this turn: best blocks, plus one unknown trap. */
export function guaranteedDamage(m: Match, me: Side): number {
  if (m.turn !== me || m.phase !== "main" || m.attacked || m.turnCount <= 1) return 0;
  const foe = other(me);
  const attackers = m.players[me].units
    .filter((unit) => canAttack(m, unit))
    .map((unit) => ({ power: power(m, unit), crush: cardOf(unit.defId).tags.includes("crush") }))
    .sort((a, b) => b.power - a.power);
  const blockers = m.players[foe].units
    .filter((unit) => canBlock(unit))
    .map((unit) => toughness(unit))
    .sort((a, b) => b - a);
  let damage = 0;
  const unblocked: number[] = [];
  let b = 0;
  for (const attacker of attackers) {
    if (b < blockers.length) {
      const hp = blockers[b++]!;
      if (attacker.crush) damage += Math.max(0, attacker.power - hp);
    } else {
      unblocked.push(attacker.power);
      damage += attacker.power;
    }
  }
  const traps = attackTraps({ ...m, phase: "trap" }).length;
  if (traps > 0 && attackers.length) damage -= Math.max(4, unblocked[0] ?? 0);
  return Math.max(0, damage);
}

const LETHAL_PARTS = new Set(["hit", "boom", "rally", "charge", "grantHaste", "overclock", "buff"]);

function lethalTarget(m: Match, me: Side, card: CardDef): Target | null {
  const foe = other(me);
  const t = card.play?.t;
  if (t === "hit") return { kind: "face", side: foe };
  const mine = m.players[me].units;
  if (t === "grantHaste") {
    const sick = mine.filter(
      (unit) =>
        unit.sick &&
        !canAttack(m, unit) &&
        !cardOf(unit.defId).noAttack &&
        !unit.frozen &&
        unit.ready,
    );
    const pick = sick.sort((a, b) => power(m, b) - power(m, a))[0];
    return pick ? { kind: "unit", uid: pick.uid } : null;
  }
  if (t === "overclock") {
    const bots = mine.filter(
      (unit) =>
        cardOf(unit.defId).faction === "robot" &&
        unit.ready &&
        !unit.frozen &&
        !cardOf(unit.defId).noAttack,
    );
    const pick = bots.sort((a, b) => Number(canAttack(m, a)) - Number(canAttack(m, b)))[0];
    return pick ? { kind: "unit", uid: pick.uid } : null;
  }
  if (t === "charge" || t === "buff") {
    const able = mine.filter((unit) => canAttack(m, unit) && (t !== "charge" || unit.hp > 1));
    const pick = able.sort(
      (a, b) =>
        Number(cardOf(b.defId).tags.includes("crush")) -
        Number(cardOf(a.defId).tags.includes("crush")),
    )[0];
    return pick ? { kind: "unit", uid: pick.uid } : null;
  }
  return null;
}

/** Order inside a lethal line: bodies first, then enablers and buffs, burn last. */
function lethalRank(card: CardDef): number {
  if (card.kind === "unit") return card.play?.t === "hit" ? 1 : 0;
  const t = card.play?.t;
  if (t === "grantHaste" || t === "overclock") return 2;
  if (t === "buff" || t === "charge") return 3;
  if (t === "rally") return 4;
  return 5;
}

/** The first action of a line that wins this turn, or null. */
export function lethalStep(
  m: Match,
  me: Side,
): { uid: string; target: Target | null } | "attack" | null {
  const foe = other(me);
  const need = () => m.players[foe].hp + m.players[foe].ward;
  if (guaranteedDamage(m, me) >= need()) return "attack";
  const parts = playable(m, me)
    .filter(
      ({ card }) =>
        (card.play && LETHAL_PARTS.has(card.play.t)) ||
        (card.kind === "unit" &&
          (card.tags.includes("haste") || (card.surge?.t === "self" && card.surge.haste))),
    )
    .slice(0, 7);
  if (!parts.length) return null;
  let best: { steps: number; first: { uid: string; target: Target | null } } | null = null;
  const total = 1 << parts.length;
  for (let mask = 1; mask < total; mask++) {
    const pick = parts.filter((_, i) => mask & (1 << i));
    if (pick.reduce((sum, item) => sum + item.card.cost, 0) > m.players[me].mana) continue;
    if (best && pick.length >= best.steps) continue;
    const ordered = [...pick].sort((a, b) => lethalRank(a.card) - lethalRank(b.card));
    let state = m;
    let first: { uid: string; target: Target | null } | null = null;
    let ok = true;
    for (const item of ordered) {
      const target = needsTarget(item.card) ? lethalTarget(state, me, item.card) : null;
      if (needsTarget(item.card) && !target) {
        ok = false;
        break;
      }
      const result = playCard(state, item.uid, target);
      if (result.error) {
        ok = false;
        break;
      }
      first ??= { uid: item.uid, target };
      state = result.state;
      if (state.winner !== null) break;
    }
    if (!ok || !first) continue;
    const won =
      state.winner === me ||
      guaranteedDamage(state, me) >= state.players[foe].hp + state.players[foe].ward;
    if (won) best = { steps: pick.length, first };
  }
  return best ? best.first : null;
}

/** What the rival's attack set would leave us after their predicted blocks. */
function attackOutcome(m: Match, me: Side, ids: string[]): number {
  const declared = declareAttack(m, ids);
  if (declared.error) return -Infinity;
  let state = declared.state;
  const foe = other(me);
  const trapRisk = state.phase === "trap" ? 1 : 0;
  if (state.phase === "trap") state = skipTrap(state).state;
  const blocks = normalBlocks(state, "guard", foe);
  let resolved = assignDefenders(state, blocks);
  if (resolved.error)
    resolved = assignDefenders(state, Object.fromEntries(state.attackers.map((id) => [id, null])));
  const after = resolved.state;
  const risk = trapRisk
    ? Math.max(...ids.map((id) => unitValueById(m, id)), 0) *
      0.35 *
      Math.min(1, m.players[foe].traps.length / 2 + 0.5)
    : 0;
  return evaluate(after, me, foe) - risk;
}

function unitValueById(m: Match, id: string): number {
  const unit = findUnit(m, id);
  return unit ? unitValue(m, unit) : 0;
}

/** Candidate attacker sets: all, none, the Normal picks, singles and all-but-one. */
function attackSets(m: Match, me: Side): string[][] {
  const ready = m.players[me].units.filter((unit) => canAttack(m, unit)).map((unit) => unit.uid);
  if (!ready.length) return [];
  const sets = new Map<string, string[]>();
  const add = (ids: string[]) => {
    if (!ids.length) return;
    const key = [...ids].sort().join(",");
    if (!sets.has(key)) sets.set(key, ids);
  };
  add(ready);
  add(sharpAttackers(m, "guard", me));
  add(sharpAttackers(m, "aggro", me));
  for (const id of ready) add([id]);
  if (ready.length > 2) for (const id of ready) add(ready.filter((item) => item !== id));
  return [...sets.values()];
}

function bestAttack(m: Match, me: Side): { ids: string[]; score: number } | null {
  let best: { ids: string[]; score: number } | null = null;
  for (const ids of attackSets(m, me)) {
    const score = attackOutcome(m, me, ids);
    if (!best || score > best.score) best = { ids, score };
  }
  return best;
}

/** Value of a state where we may still attack this turn. */
function withAttack(m: Match, me: Side): number {
  const hold = evaluate(m, me);
  if (m.attacked || m.turnCount <= 1) return hold;
  const attack = bestAttack(m, me);
  return attack ? Math.max(hold, attack.score) : hold;
}

export function hardMain(m: Match, me: Side): Match {
  const lethal = lethalStep(m, me);
  if (lethal === "attack") {
    const ids = m.players[me].units.filter((unit) => canAttack(m, unit)).map((unit) => unit.uid);
    const declared = declareAttack(m, ids);
    if (!declared.error) return declared.state;
  } else if (lethal) {
    const result = playCard(m, lethal.uid, lethal.target);
    if (!result.error) return result.state;
  }

  const canStillAttack = !m.attacked && m.turnCount > 1;
  const baseline = canStillAttack ? withAttack(m, me) : evaluate(m, me);
  let best: { uid: string; target: Target | null; score: number } | null = null;
  for (const { uid, card } of playable(m, me)) {
    for (const target of targetsFor(m, me, card)) {
      const result = playCard(m, uid, target);
      if (result.error) continue;
      const after = result.state;
      const setsUpAttack =
        canStillAttack &&
        (card.kind === "spell" || card.tags.includes("haste") || card.play?.t === "hit");
      let score = setsUpAttack ? withAttack(after, me) : evaluate(after, me);
      if (canStillAttack && !setsUpAttack)
        score = Math.max(score, score + (baseline - evaluate(m, me)));
      score += card.cost * 0.15;
      if (card.surge && !surgeActive(m) && waitsForSurge(m, me, uid, card))
        score -= surgeValue(card);
      if (!best || score > best.score) best = { uid, target, score };
    }
  }
  if (best && best.score > baseline + 0.2) {
    const result = playCard(m, best.uid, best.target);
    if (!result.error) return result.state;
  }

  if (canStillAttack) {
    const attack = bestAttack(m, me);
    if (attack && attack.score > evaluate(m, me) + 0.1) {
      const declared = declareAttack(m, attack.ids);
      if (!declared.error) return declared.state;
    }
  }
  return endTurn(m).state;
}

function resolveBlocks(m: Match, me: Side, blocks: Record<string, string | null>): Match | null {
  const result = assignDefenders(m, blocks);
  return result.error ? null : result.state;
}

/** Best block plan for `me`: the Normal plan, improved by one-swap local search. */
export function hardBlockPlan(m: Match, me: Side): Record<string, string | null> {
  const attacker = other(me);
  const open: Record<string, string | null> = Object.fromEntries(
    m.attackers.map((id) => [id, null]),
  );
  const blockers = m.players[me].units.filter((unit) => canBlock(unit)).map((unit) => unit.uid);
  const score = (plan: Record<string, string | null>) => {
    const after = resolveBlocks(m, me, plan);
    return after ? evaluate(after, me, me) : -Infinity;
  };
  let plan = { ...open, ...normalBlocks(m, "guard", me) };
  let value = score(plan);
  const openValue = score(open);
  if (openValue > value) {
    plan = open;
    value = openValue;
  }
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (const id of m.attackers) {
      for (const choice of [null, ...blockers]) {
        if (plan[id] === choice) continue;
        const next = { ...plan };
        if (choice) for (const key of Object.keys(next)) if (next[key] === choice) next[key] = null;
        next[id] = choice;
        const v = score(next);
        if (v > value + 0.01) {
          plan = next;
          value = v;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  void attacker;
  return plan;
}

export function hardBlock(m: Match, me: Side): Match {
  const plan = hardBlockPlan(m, me);
  const after = resolveBlocks(m, me, plan);
  return after ?? assignDefenders(m, Object.fromEntries(m.attackers.map((id) => [id, null]))).state;
}

/** After a trap choice, how good is the position once we block well? */
function afterTrap(state: Match, me: Side): number {
  if (state.winner !== null || state.phase !== "defend") return evaluate(state, me, me);
  const after = resolveBlocks(state, me, hardBlockPlan(state, me));
  return after ? evaluate(after, me, me) : evaluate(state, me, me);
}

export function hardTrap(m: Match, me: Side): Match {
  const skipped = skipTrap(m).state;
  let best: { state: Match; score: number } = { state: skipped, score: afterTrap(skipped, me) };
  for (const trap of attackTraps(m)) {
    const card = cardOf(trap.defId);
    if (card.trap === "soul") continue;
    const targets = card.trap === "firewall" ? [null] : m.attackers;
    for (const target of targets) {
      const sprung = springTrap(m, trap.uid, target);
      if (sprung.error) continue;
      const score = afterTrap(sprung.state, me);
      if (score > best.score + 0.3) best = { state: sprung.state, score };
    }
  }
  return best.state;
}
