import {
  assignDefenders,
  declareAttack,
  endTurn,
  playCard,
  skipTrap,
  springTrap,
  type Match,
  type Side,
} from "./logic";

export type SeatAct =
  | { t: "play"; uid: string; target: { kind: "unit"; uid: string } | { kind: "face"; side: Side } | null }
  | { t: "attack"; ids: string[] }
  | { t: "block"; blocks: Record<string, string | null> }
  | { t: "trap"; uid: string; target: string | null }
  | { t: "skip" }
  | { t: "end" };

function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

function flipLog(line: string): string {
  return line
    .replaceAll("You win.", "§WIN")
    .replaceAll("You lose.", "You win.")
    .replaceAll("§WIN", "You lose.")
    .replaceAll("Your", "§YOUR")
    .replaceAll("Rival", "Your")
    .replaceAll("§YOUR", "Rival")
    .replaceAll("The rival", "§TR")
    .replaceAll("the rival", "§tr")
    .replaceAll("You ", "The rival ")
    .replace(/\byou\b/g, "the rival")
    .replaceAll("§TR", "You")
    .replaceAll("§tr", "you");
}

export function flipMatch(match: Match): Match {
  const next = structuredClone(match);
  next.players = [next.players[1], next.players[0]];
  for (const seat of next.players) {
    for (const unit of seat.units) unit.owner = other(unit.owner);
    for (const trap of seat.traps) trap.owner = other(trap.owner);
  }
  next.turn = other(next.turn);
  next.winner = next.winner === null ? null : other(next.winner);
  next.log = next.log.map(flipLog);
  return next;
}

export function flipAct(action: SeatAct): SeatAct {
  if (action.t !== "play" || !action.target || action.target.kind !== "face") return action;
  return { ...action, target: { kind: "face", side: other(action.target.side) } };
}

export function actor(match: Match): Side {
  if (match.phase === "main") return match.turn;
  return other(match.turn);
}

export function applySeat(match: Match, seat: Side, action: SeatAct): { state: Match; error?: string } {
  if (match.winner !== null) return { state: match, error: "The duel is over." };
  if (actor(match) !== seat) return { state: match, error: "Not your step." };
  if (action.t === "play") return playCard(match, action.uid, action.target);
  if (action.t === "attack") return declareAttack(match, action.ids);
  if (action.t === "block") return assignDefenders(match, action.blocks);
  if (action.t === "trap") return springTrap(match, action.uid, action.target);
  if (action.t === "skip") return skipTrap(match);
  return endTurn(match);
}

export function expireMatch(match: Match): Match | null {
  if (match.winner !== null) return null;
  if (match.phase === "main") {
    const ended = endTurn(match);
    return ended.error ? null : ended.state;
  }
  if (match.phase === "trap") {
    const skipped = skipTrap(match);
    return skipped.error ? null : skipped.state;
  }
  const open = Object.fromEntries(match.attackers.map((id) => [id, null]));
  const blocked = assignDefenders(match, open);
  return blocked.error ? null : blocked.state;
}

export function clockMs(match: Match): number {
  return match.phase === "trap" || match.phase === "defend" ? 6_000 : 60_000;
}
