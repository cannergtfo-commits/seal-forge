import { cardOf, needsTarget, trapNeedsTarget } from "./cards";
import type { BotStyle } from "./bots";
import {
  assignDefenders,
  attackTraps,
  canAttack,
  canBlock,
  declareAttack,
  endTurn,
  findUnit,
  playCard,
  power,
  skipTrap,
  springTrap,
  type Match,
  type Target,
  type Unit,
} from "./logic";

function enemyUnits(m: Match): Unit[] {
  return m.players[0].units;
}

function aiUnits(m: Match): Unit[] {
  return m.players[1].units;
}

function targetFor(m: Match, handUid: string): Target | null {
  const hand = m.players[1].hand.find((card) => card.uid === handUid);
  if (!hand) return null;
  const card = cardOf(hand.defId);
  const effect = card.play?.t;
  if (!needsTarget(card)) return null;
  if (effect === "hit") {
    const prey = [...enemyUnits(m)].sort((a, b) => a.hp - b.hp).find((unit) => unit.hp <= (card.play && card.play.t === "hit" ? card.play.n : 0) + 1);
    if (prey) return { kind: "unit", uid: prey.uid };
    if (m.players[0].hp <= 8) return { kind: "face", side: 0 };
    const big = [...enemyUnits(m)].sort((a, b) => power(m, b) - power(m, a))[0];
    return big ? { kind: "unit", uid: big.uid } : { kind: "face", side: 0 };
  }
  if (effect === "healUnit") {
    const hurt = [...aiUnits(m)].filter((unit) => unit.hp < unit.maxHp).sort((a, b) => a.hp - b.hp)[0];
    return hurt ? { kind: "unit", uid: hurt.uid } : aiUnits(m)[0] ? { kind: "unit", uid: aiUnits(m)[0]!.uid } : null;
  }
  if (effect === "buff" || effect === "charge" || effect === "grantHaste") {
    const allies = [...aiUnits(m)];
    if (effect === "grantHaste") {
      const waiting = allies.find((unit) => unit.sick && !cardOf(unit.defId).tags.includes("haste") && !cardOf(unit.defId).tags.includes("swift"));
      if (waiting) return { kind: "unit", uid: waiting.uid };
    }
    const ally = allies.sort((a, b) => power(m, b) - power(m, a))[0];
    return ally ? { kind: "unit", uid: ally.uid } : null;
  }
  if (effect === "overclock") {
    const bot = aiUnits(m).find((unit) => cardOf(unit.defId).faction === "robot");
    return bot ? { kind: "unit", uid: bot.uid } : null;
  }
  if (effect === "freeze") {
    const threat = [...enemyUnits(m)].sort((a, b) => power(m, b) - power(m, a))[0];
    return threat ? { kind: "unit", uid: threat.uid } : null;
  }
  return null;
}

function easyTarget(m: Match, handUid: string): Target | null {
  const hand = m.players[1].hand.find((card) => card.uid === handUid);
  if (!hand) return null;
  const card = cardOf(hand.defId);
  if (!needsTarget(card)) return null;
  const effect = card.play?.t;
  if (effect === "hit") return { kind: "face", side: 0 };
  if (effect === "freeze") {
    const any = enemyUnits(m)[0];
    return any ? { kind: "unit", uid: any.uid } : null;
  }
  const ally = aiUnits(m)[0];
  return ally ? { kind: "unit", uid: ally.uid } : null;
}

function chooseEasy(m: Match): { uid: string; target: Target | null } | null {
  const seat = m.players[1];
  const latest = m.log[0] ?? "";
  if (seat.mana < seat.manaMax || latest.startsWith("Played ") || latest.startsWith("Cast ") || latest.startsWith("Set ")) return null;
  const options = seat.hand
    .map((hand) => ({ hand, card: cardOf(hand.defId) }))
    .filter(({ card }) => card.cost <= seat.mana)
    .filter(({ card }) => (card.kind === "unit" ? seat.units.length < 6 : true))
    .filter(({ card }) => (card.kind === "trap" ? seat.traps.length < 3 : true))
    .sort((a, b) => a.card.cost - b.card.cost || a.card.atk - b.card.atk);
  const pick = options.find((option) => option.card.kind === "unit") ?? options[0];
  if (!pick) return null;
  const target = needsTarget(pick.card) ? easyTarget(m, pick.hand.uid) : null;
  if (needsTarget(pick.card) && !target) return null;
  return { uid: pick.hand.uid, target };
}

function stepEasyMain(m: Match): Match {
  const play = chooseEasy(m);
  if (play) {
    const result = playCard(m, play.uid, play.target);
    if (!result.error) return result.state;
  }
  const ready = m.players[1].units.filter((unit) => canAttack(m, unit)).sort((a, b) => power(m, a) - power(m, b));
  const one = ready[0];
  if (!one || m.attacked) return endTurn(m).state;
  const declared = declareAttack(m, [one.uid]);
  return declared.error ? endTurn(m).state : declared.state;
}

function sharpAttackers(m: Match, style: BotStyle): string[] {
  const ready = m.players[1].units.filter((unit) => canAttack(m, unit));
  if (!ready.length) return [];
  const foes = enemyUnits(m);
  if (!foes.length) return ready.map((unit) => unit.uid);
  const byPower = [...ready].sort((a, b) => power(m, b) - power(m, a));
  const through = byPower.slice(foes.length).reduce((sum, unit) => sum + power(m, unit), 0);
  if (through >= m.players[0].hp) return ready.map((unit) => unit.uid);
  const kept = ready.filter((unit) => {
    const atk = power(m, unit);
    const survives = foes.every((foe) => power(m, foe) < unit.hp);
    const favorable = foes.some((foe) => atk >= foe.hp && power(m, foe) < unit.hp);
    if (survives || favorable || cardOf(unit.defId).tags.includes("bulwark")) return true;
    return style === "aggro" && m.players[1].hp >= m.players[0].hp && atk >= 3;
  });
  if (kept.length || style === "guard") return kept.map((unit) => unit.uid);
  const best = byPower[0];
  if (best && foes.some((foe) => power(m, best) >= foe.hp && power(m, foe) <= best.hp)) return [best.uid];
  return [];
}

function choosePlay(m: Match, style: BotStyle): { uid: string; target: Target | null } | null {
  if (style === "easy") return chooseEasy(m);
  const seat = m.players[1];
  const options = seat.hand
    .map((hand) => ({ hand, card: cardOf(hand.defId) }))
    .filter(({ card }) => card.cost <= seat.mana)
    .filter(({ card }) => (card.kind === "unit" ? seat.units.length < 6 : true))
    .filter(({ card }) => (card.kind === "trap" ? seat.traps.length < 3 : true));
  const ranked = options
    .map((option) => {
      const target = needsTarget(option.card) ? targetFor(m, option.hand.uid) : null;
      if (needsTarget(option.card) && !target) return null;
      let score = option.card.cost * 2;
      if (option.card.kind === "unit") score += option.card.atk + option.card.hp;
      if (option.card.play?.t === "healSelf" && seat.hp <= 12) score += 8;
      if (option.card.play?.t === "hit") score += 5;
      if (option.card.kind === "trap" && seat.traps.length === 0) score += 3;
      if (option.card.rarity === "legendary") score += 4;
      else if (option.card.rarity === "rare") score += 2;
      const foes = enemyUnits(m);
      const threat = foes.reduce((best, unit) => Math.max(best, power(m, unit)), 0);
      if (option.card.play?.t === "hit") {
        const amount = option.card.play.n;
        if (foes.some((unit) => unit.hp <= amount)) score += 6 + Math.min(threat, 6);
        else if (m.players[0].hp > 10) score -= 2;
      }
      if (option.card.cost === seat.mana) score += 2;
      if (option.card.play?.t === "healSelf" && seat.hp > 16) score -= 8;
      if (option.card.kind === "unit" && seat.units.length < foes.length) score += 3;
      if (option.card.kind === "trap" && foes.length > 0 && seat.traps.length === 0) score += 3;
      if (option.card.tags.includes("haste") || option.card.tags.includes("swift")) score += 2;
      if (style === "aggro") {
        if (option.card.kind === "unit" && option.card.cost <= 2) score += 4;
        if (option.card.play?.t === "hit" || option.card.tags.includes("swift") || option.card.tags.includes("haste")) score += 3;
      } else {
        if (option.card.tags.includes("bulwark") || option.card.kind === "trap") score += 4;
        if (option.card.play?.t === "healSelf" || option.card.play?.t === "healUnit") score += 3;
      }
      return { uid: option.hand.uid, target, score };
    })
    .filter((item): item is { uid: string; target: Target | null; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best ? { uid: best.uid, target: best.target } : null;
}

function stepAiMain(m: Match, style: BotStyle): Match {
  if (style === "easy") return stepEasyMain(m);
  const play = choosePlay(m, style);
  if (play) {
    const result = playCard(m, play.uid, play.target);
    if (!result.error) return result.state;
  }
  const ids = sharpAttackers(m, style);
  if (ids.length === 0 || m.attacked) return endTurn(m).state;
  const declared = declareAttack(m, ids);
  return declared.error ? endTurn(m).state : declared.state;
}

function aiMain(m: Match, style: BotStyle): Match {
  let next = m;
  for (let i = 0; i < 8; i++) {
    if (next.winner || next.turn !== 1 || next.phase !== "main") return next;
    next = stepAiMain(next, style);
  }
  return next;
}

function aiTrap(m: Match, style: BotStyle): Match {
  const traps = attackTraps(m).filter((trap) => cardOf(trap.defId).trap !== "soul");
  const attackers = m.attackers.map((id) => findUnit(m, id)).filter((unit): unit is Unit => Boolean(unit));
  if (!traps.length || !attackers.length) return skipTrap(m).state;
  if (style === "easy") {
    if (m.turnCount % 2 === 0) return skipTrap(m).state;
    const trap = traps[0]!;
    const card = cardOf(trap.defId);
    if (!trapNeedsTarget(card.trap)) return springTrap(m, trap.uid, null).state;
    const small = [...attackers].sort((a, b) => power(m, a) - power(m, b))[0];
    if (!small || (card.trap === "snare" && power(m, small) > 2)) return skipTrap(m).state;
    const sprung = springTrap(m, trap.uid, small.uid);
    return sprung.error ? skipTrap(m).state : sprung.state;
  }
  const incoming = attackers.reduce((sum, unit) => sum + power(m, unit), 0);
  let best: { uid: string; target: string | null; score: number } | null = null;
  for (const trap of traps) {
    const card = cardOf(trap.defId);
    const kind = card.trap;
    if (kind === "firewall") {
      const score = incoming >= 4 ? incoming : 0;
      if (score > (best?.score ?? 0)) best = { uid: trap.uid, target: null, score };
      continue;
    }
    if (!trapNeedsTarget(kind)) continue;
    const legal = kind === "snare" ? attackers.filter((unit) => power(m, unit) <= 2) : attackers;
    const picked = [...legal].sort((a, b) => power(m, b) - power(m, a))[0];
    if (!picked) continue;
    let score = power(m, picked);
    if (kind === "snare") score += 6;
    if (kind === "horizon") score += 3;
    if (kind === "pikes") score += 2;
    if (incoming < 2 && kind !== "snare") score = 0;
    if (score > (best?.score ?? 0)) best = { uid: trap.uid, target: picked.uid, score };
  }
  if (!best || best.score <= 0) return skipTrap(m).state;
  const sprung = springTrap(m, best.uid, best.target);
  return sprung.error ? skipTrap(m).state : sprung.state;
}

function aiBlock(m: Match, style: BotStyle): Match {
  const defenderHp = m.players[1].hp;
  const attackers = m.attackers.map((id) => findUnit(m, id)).filter((unit): unit is Unit => Boolean(unit));
  const blockers = m.players[1].units.filter((unit) => canBlock(unit));
  const used = new Set<string>();
  const incoming = attackers.reduce((sum, unit) => sum + power(m, unit), 0);
  const lethal = incoming >= defenderHp;
  const open = Object.fromEntries(attackers.map((unit) => [unit.uid, null]));
  if (style === "easy") {
    if (!lethal) return assignDefenders(m, open).state;
    const attacker = [...attackers].sort((a, b) => {
      const aw = cardOf(a.defId).tags.includes("bulwark") ? 1 : 0;
      const bw = cardOf(b.defId).tags.includes("bulwark") ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return power(m, b) - power(m, a);
    })[0];
    const blocker = [...blockers].sort((a, b) => a.hp - b.hp)[0];
    if (!attacker || !blocker) return assignDefenders(m, open).state;
    const blocks = { ...open, [attacker.uid]: blocker.uid };
    const result = assignDefenders(m, blocks);
    return result.error ? assignDefenders(m, open).state : result.state;
  }
  const blocks: Record<string, string | null> = {};
  const ordered = [...attackers].sort((a, b) => {
    const aw = cardOf(a.defId).tags.includes("bulwark") ? 1 : 0;
    const bw = cardOf(b.defId).tags.includes("bulwark") ? 1 : 0;
    if (aw !== bw) return bw - aw;
    return power(m, b) - power(m, a);
  });
  for (const attacker of ordered) {
    let best: Unit | null = null;
    let bestScore = 0;
    for (const blocker of blockers) {
      if (used.has(blocker.uid)) continue;
      const kills = power(m, blocker) >= attacker.hp;
      const dies = power(m, attacker) >= blocker.hp;
      let score = 0;
      if (kills && !dies) score = 8;
      else if (kills && dies) score = power(m, attacker) >= power(m, blocker) ? 5 : 2;
      else if (lethal && power(m, attacker) >= 2) score = 1;
      if (cardOf(attacker.defId).tags.includes("bulwark") && (score > 0 || lethal)) score += 3;
      if (style === "aggro" && score < 5 && !lethal) score = 0;
      if (score > bestScore || (score === bestScore && best && blocker.hp < best.hp)) {
        best = blocker;
        bestScore = score;
      }
    }
    if (best && bestScore > 0) {
      blocks[attacker.uid] = best.uid;
      used.add(best.uid);
    } else {
      blocks[attacker.uid] = null;
    }
  }
  const result = assignDefenders(m, blocks);
  return result.error ? assignDefenders(m, open).state : result.state;
}

/** One rival action, so the table can show it. Null when the player must decide. */
export function stepRival(state: Match, style: BotStyle = "guard"): Match | null {
  if (state.winner !== null) return null;
  if (state.turn === 0 && state.phase === "main") return null;
  if (state.turn === 1 && (state.phase === "trap" || state.phase === "defend")) return null;
  if (state.turn === 1 && state.phase === "main") return stepAiMain(state, style);
  if (state.turn === 0 && state.phase === "trap") return aiTrap(state, style);
  if (state.turn === 0 && state.phase === "defend") return aiBlock(state, style);
  return null;
}

/** Advance rival decisions until it is your main phase, or you must block. */
export function settle(state: Match, style: BotStyle = "guard"): Match {
  let m = state;
  for (let i = 0; i < 8 && m.winner === null; i++) {
    if (m.turn === 0 && m.phase === "main") break;
    if (m.turn === 1 && (m.phase === "trap" || m.phase === "defend")) break;
    if (m.turn === 1 && m.phase === "main") {
      m = aiMain(m, style);
      continue;
    }
    if (m.turn === 0 && m.phase === "trap") {
      m = aiTrap(m, style);
      continue;
    }
    if (m.turn === 0 && m.phase === "defend") {
      m = aiBlock(m, style);
      continue;
    }
    break;
  }
  return m;
}
