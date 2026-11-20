import {
  cardOf,
  needsTarget,
  starterIds,
  trapNeedsTarget,
  type CardDef,
  type Faction,
  type PlayEffect,
  type Tag,
} from "./cards";

export type Side = 0 | 1;

export type HandCard = { uid: string; defId: string };

export type Unit = {
  uid: string;
  defId: string;
  owner: Side;
  atk: number;
  hp: number;
  maxHp: number;
  sick: boolean;
  ready: boolean;
  frozen: boolean;
  swing: number;
  /** Plating on this unit (printed plus granted). Optional so older saved matches still load. */
  plating?: number;
  /** Plating left to absorb damage this turn. Refills at the start of every turn. */
  plateLeft?: number;
  /** Keywords gained after it was played (Tithe, spells). */
  granted?: Tag[];
  /** True while this unit has its Formation +1 health applied. */
  formed?: boolean;
  /** Unsealed: printed keywords, abilities and auras are off for good. */
  silenced?: boolean;
  /** Set once the unit has attacked (ends Veilstep). */
  revealed?: boolean;
};

export type Trap = { uid: string; defId: string; owner: Side };

export type Seat = {
  hp: number;
  ward: number;
  mana: number;
  manaMax: number;
  deck: string[];
  hand: HandCard[];
  grave: string[];
  units: Unit[];
  traps: Trap[];
};

export type Phase = "main" | "trap" | "defend" | "over";

export type Match = {
  players: [Seat, Seat];
  turn: Side;
  turnCount: number;
  phase: Phase;
  winner: Side | null;
  log: string[];
  attackers: string[];
  attacked: boolean;
  /** Cards the player whose turn it is has played this turn (for Surge). */
  played?: number;
  seed: number;
  seq: number;
};

export type Target = { kind: "unit"; uid: string } | { kind: "face"; side: Side };

const BOARD = 6;
const HAND = 7;
const TRAPS = 3;

function clone(m: Match): Match {
  return structuredClone(m);
}

function note(m: Match, text: string): void {
  m.log = [text, ...m.log].slice(0, 14);
}

function rand(m: Match): number {
  m.seed = (Math.imul(m.seed, 1664525) + 1013904223) >>> 0;
  return m.seed / 4294967296;
}

function uid(m: Match): string {
  m.seq += 1;
  return `c${m.seq}`;
}

function shuffle(m: Match, list: string[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(m) * (i + 1));
    const a = list[i]!;
    list[i] = list[j]!;
    list[j] = a;
  }
}

export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

export function findUnit(m: Match, id: string): Unit | null {
  for (const seat of m.players) {
    const unit = seat.units.find((item) => item.uid === id);
    if (unit) return unit;
  }
  return null;
}

function hasAura(m: Match, owner: Side, aura: "goblinAtk" | "goblinSwift"): boolean {
  return m.players[owner].units.some((unit) => !unit.silenced && cardOf(unit.defId).aura === aura);
}

/** True when the unit has the keyword, printed or granted. */
export function hasTag(unit: Unit, tag: Tag): boolean {
  return (!unit.silenced && cardOf(unit.defId).tags.includes(tag)) || Boolean(unit.granted?.includes(tag));
}

/** True when this unit still can't attack (printed "Can't attack", unless Unsealed). */
export function noAttack(unit: Unit): boolean {
  return Boolean(cardOf(unit.defId).noAttack) && !unit.silenced;
}

/** Veilstep: the rival's cards and traps can't target this until it has attacked. */
export function canTarget(m: Match, by: Side, unit: Unit): boolean {
  return unit.owner === by || !(hasTag(unit, "veilstep") && !unit.revealed);
}

/**
 * Unseal: the unit loses printed keywords, abilities, auras, granted keywords and
 * every buff. Stats go back to printed; damage it has taken stays (health is capped
 * at the printed value, so this never kills).
 */
export function unsealUnit(unit: Unit): void {
  const card = cardOf(unit.defId);
  unit.silenced = true;
  unit.granted = [];
  unit.formed = false;
  unit.plating = 0;
  unit.plateLeft = 0;
  unit.swing = 0;
  unit.atk = card.atk;
  unit.maxHp = card.hp;
  unit.hp = Math.min(unit.hp, card.hp);
}

/** Formation is on while its owner controls 3 or more units. */
export function formationActive(m: Match, unit: Unit): boolean {
  return hasTag(unit, "formation") && m.players[unit.owner].units.filter((item) => item.hp > 0).length >= 3;
}

/**
 * Keeps Formation's +1 health in step with the board. Losing it lowers max health,
 * and current health only drops to the new max, so losing the bonus never kills.
 */
function syncFormation(m: Match): void {
  for (const seat of m.players) {
    for (const unit of seat.units) {
      if (unit.hp <= 0) continue;
      const on = formationActive(m, unit);
      if (on && !unit.formed) {
        unit.formed = true;
        unit.hp += 1;
        unit.maxHp += 1;
      } else if (!on && unit.formed) {
        unit.formed = false;
        unit.maxHp -= 1;
        unit.hp = Math.max(1, Math.min(unit.hp, unit.maxHp));
      }
    }
  }
}

export function power(m: Match, unit: Unit): number {
  const card = cardOf(unit.defId);
  let atk = unit.atk + unit.swing;
  if (formationActive(m, unit)) atk += 1;
  if (card.faction === "goblin" && card.aura !== "goblinAtk" && hasAura(m, unit.owner, "goblinAtk")) atk += 1;
  return Math.max(0, atk);
}

export function canAttack(m: Match, unit: Unit): boolean {
  if (m.phase !== "main" || m.turn !== unit.owner || m.attacked) return false;
  if (m.turnCount <= 1) return false;
  if (!unit.ready || unit.frozen) return false;
  if (power(m, unit) <= 0) return false;
  const card = cardOf(unit.defId);
  if (noAttack(unit)) return false;
  if (unit.sick && !hasTag(unit, "haste") && !(card.faction === "goblin" && hasAura(m, unit.owner, "goblinSwift"))) return false;
  return true;
}

export function canBlock(unit: Unit): boolean {
  return unit.ready && !unit.frozen;
}

function crown(m: Match): void {
  const dead0 = m.players[0].hp <= 0;
  const dead1 = m.players[1].hp <= 0;
  if (dead0 && !dead1) m.winner = 1;
  else if (dead1 && !dead0) m.winner = 0;
  else if (dead0 && dead1) m.winner = other(m.turn);
  if (m.winner !== null) {
    m.phase = "over";
    note(m, m.winner === 0 ? "You win." : "You lose.");
  }
}

function hurt(m: Match, side: Side, amount: number, drainOwner: Side | null): number {
  if (amount <= 0 || m.winner !== null) return 0;
  const seat = m.players[side];
  const soaked = Math.min(seat.ward, amount);
  seat.ward -= soaked;
  const dealt = amount - soaked;
  seat.hp -= dealt;
  if (drainOwner !== null && dealt > 0) {
    healPlayer(m, drainOwner, dealt);
  }
  crown(m);
  return dealt;
}

function draw(m: Match, side: Side, n: number): void {
  const seat = m.players[side];
  for (let i = 0; i < n; i++) {
    if (m.winner !== null) return;
    const id = seat.deck.pop();
    if (!id) {
      seat.hp -= 1;
      note(m, `${side === 0 ? "You" : "The rival"} fatigue for 1.`);
      crown(m);
      continue;
    }
    if (seat.hand.length >= HAND) {
      seat.grave.push(id);
      note(m, `${cardOf(id).name} is discarded (hand full).`);
    } else {
      seat.hand.push({ uid: uid(m), defId: id });
    }
  }
}

function loseLife(m: Match, side: Side, n: number, floorAt: number): void {
  const seat = m.players[side];
  seat.hp = Math.max(floorAt, seat.hp - n);
  if (seat.hp <= 0) crown(m);
}

export function hasBloom(unit: Unit): boolean {
  return hasTag(unit, "bloom");
}

/** Bloom: whenever you heal (your life or an ally unit), each of your Bloom units gets +1 attack. */
function bloom(m: Match, side: Side): void {
  const grown = m.players[side].units.filter((unit) => unit.hp > 0 && hasBloom(unit));
  for (const unit of grown) unit.atk += 1;
  if (grown.length) note(m, `Bloom: ${grown.length === 1 ? cardOf(grown[0]!.defId).name : `${grown.length} units`} +1 attack.`);
}

/** Every life gain goes through here, so Bloom sees it. Life caps at 30. */
function healPlayer(m: Match, side: Side, amount: number): void {
  if (amount <= 0) return;
  m.players[side].hp = Math.min(30, m.players[side].hp + amount);
  bloom(m, side);
}

/** Deals damage to a unit through its Plating. Returns the damage that got through. */
export function damageUnit(unit: Unit, amount: number): number {
  if (amount <= 0) return 0;
  const absorbed = Math.min(unit.plateLeft ?? 0, amount);
  if (absorbed) unit.plateLeft = (unit.plateLeft ?? 0) - absorbed;
  const dealt = amount - absorbed;
  unit.hp -= dealt;
  return dealt;
}

/** Health plus the Plating it has left this turn: what it takes to kill it with damage. */
export function toughness(unit: Unit): number {
  return unit.hp + (unit.plateLeft ?? 0);
}

function runRequiem(m: Match, unit: Unit, card: CardDef): void {
  const effect = card.requiem;
  if (!effect) return;
  const owner = unit.owner;
  const seat = m.players[owner];
  if (effect.t === "heal") {
    healPlayer(m, owner, effect.n);
    note(m, `Requiem: ${card.name} mends ${effect.n}.`);
  } else if (effect.t === "draw") {
    draw(m, owner, effect.n);
    note(m, `Requiem: ${card.name} draws ${effect.n}.`);
  } else if (effect.t === "ping") {
    hurt(m, other(owner), effect.n, null);
    note(m, `Requiem: ${card.name} deals ${effect.n} to the rival.`);
  } else if (effect.t === "lose") {
    loseLife(m, owner, effect.n, 0);
    note(m, `Requiem: ${card.name} costs ${effect.n} life.`);
  } else if (effect.t === "healAlly") {
    const hurtAlly = [...seat.units].filter((item) => item.hp < item.maxHp).sort((a, b) => a.hp - b.hp)[0];
    if (hurtAlly) {
      hurtAlly.hp = Math.min(hurtAlly.maxHp, hurtAlly.hp + effect.n);
      bloom(m, owner);
      note(m, `Requiem: ${cardOf(hurtAlly.defId).name} heals ${effect.n}.`);
    }
  } else if (effect.t === "recall") {
    const pool = seat.grave
      .map((id, index) => ({ id, index }))
      .filter((item) => item.id !== card.id && cardOf(item.id).faction === effect.faction);
    if (pool.length && seat.hand.length < HAND) {
      const pick = pool[Math.floor(rand(m) * pool.length)]!;
      seat.grave.splice(pick.index, 1);
      seat.hand.push({ uid: uid(m), defId: pick.id });
      note(m, `Requiem: ${card.name} returns ${cardOf(pick.id).name}.`);
    }
  }
}

function buryUnit(m: Match, unit: Unit): void {
  const seat = m.players[unit.owner];
  seat.units = seat.units.filter((item) => item.uid !== unit.uid);
  seat.grave.push(unit.defId);
  if (!unit.silenced) runRequiem(m, unit, cardOf(unit.defId));
}

function reap(m: Match): void {
  const dead: Unit[] = [];
  for (let wave = 0; wave < 6; wave++) {
    const fresh: Unit[] = [];
    for (const seat of m.players) {
      for (const unit of seat.units) if (unit.hp <= 0) fresh.push(unit);
    }
    if (fresh.length === 0) break;
    for (const unit of fresh) buryUnit(m, unit);
    dead.push(...fresh);
  }
  if (dead.length === 0) return;
  syncFormation(m);
  for (const seat of m.players) {
    const snare = seat.traps.find((trap) => cardOf(trap.defId).trap === "soul");
    if (snare && dead.length) {
      seat.traps = seat.traps.filter((trap) => trap.uid !== snare.uid);
      seat.grave.push(snare.defId);
      healPlayer(m, m.players.indexOf(seat) as Side, 3);
      note(m, `${cardOf(snare.defId).name} heals 3.`);
    }
  }
}

function beginTurn(m: Match): void {
  if (m.winner !== null) return;
  m.turnCount += 1;
  m.phase = "main";
  m.attackers = [];
  m.attacked = false;
  m.played = 0;
  const seat = m.players[m.turn];
  seat.manaMax = Math.min(10, seat.manaMax + 1);
  seat.mana = seat.manaMax;
  for (const unit of seat.units) {
    unit.swing = 0;
    unit.ready = !unit.frozen;
    unit.sick = false;
    unit.frozen = false;
  }
  for (const unit of m.players[other(m.turn)].units) unit.swing = 0;
  for (const side of m.players) for (const unit of side.units) unit.plateLeft = unit.plating ?? 0;
  note(m, `${m.turn === 0 ? "Your" : "Rival"} turn ${m.turnCount}. Mana ${seat.manaMax}.`);
  draw(m, m.turn, 1);
}

function emptySeat(): Seat {
  return { hp: 20, ward: 0, mana: 0, manaMax: 0, deck: [], hand: [], grave: [], units: [], traps: [] };
}

export function startMatch(you: Faction, rival: Faction, seed = 1, decks?: Array<string[] | null | undefined>): Match {
  const m: Match = {
    players: [emptySeat(), emptySeat()],
    turn: 0,
    turnCount: 0,
    phase: "main",
    winner: null,
    log: ["Twenty life. One new mana each turn. The defender assigns blockers."],
    attackers: [],
    attacked: false,
    seed: seed || 1,
    seq: 0,
  };
  const factions: Faction[] = [you, rival];
  factions.forEach((faction, index) => {
    const seat = m.players[index as Side];
    const custom = decks?.[index];
    seat.deck = custom && custom.length ? [...custom] : starterIds(faction);
    shuffle(m, seat.deck);
  });
  draw(m, 0, 4);
  draw(m, 1, 5);
  beginTurn(m);
  return m;
}

function makeUnit(m: Match, card: CardDef, owner: Side): Unit {
  return {
    uid: uid(m),
    defId: card.id,
    owner,
    atk: card.atk,
    hp: card.hp,
    maxHp: card.hp,
    sick: true,
    ready: true,
    frozen: false,
    swing: 0,
    plating: card.plating ?? 0,
    plateLeft: card.plating ?? 0,
  };
}

function legalHit(m: Match, target: Target): boolean {
  if (target.kind === "face") return true;
  return Boolean(findUnit(m, target.uid));
}

function applyPlay(m: Match, card: CardDef, owner: Side, unit: Unit | null, target: Target | null): string | null {
  const effect = card.play;
  if (!effect) return null;
  if (effect.t === "hit" && effect.selfLose) {
    const err = hit(m, effect.n, target);
    if (err) return err;
    loseLife(m, owner, effect.selfLose, 0);
    note(m, `${card.name} burns you for ${effect.selfLose}.`);
    return null;
  }
  return runEffect(m, effect, owner, unit, target, card);
}

function hit(m: Match, n: number, target: Target | null): string | null {
  if (!target) return "Choose a target.";
  if (target.kind === "face") {
    hurt(m, target.side, n, null);
    note(m, `Dealt ${n} to ${target.side === 0 ? "you" : "the rival"}.`);
    return null;
  }
  const unit = findUnit(m, target.uid);
  if (!unit) return "That unit is gone.";
  const dealt = damageUnit(unit, n);
  note(m, `${cardOf(unit.defId).name} takes ${dealt}${dealt < n ? ` (Plating stops ${n - dealt})` : ""}.`);
  reap(m);
  return null;
}

function runEffect(m: Match, effect: PlayEffect, owner: Side, self: Unit | null, target: Target | null, source: CardDef): string | null {
  if (effect.t === "healSelf") {
    healPlayer(m, owner, effect.n);
    note(m, `Healed ${effect.n}.`);
    if (effect.bloomDraw && m.players[owner].units.some((unit) => hasBloom(unit))) draw(m, owner, effect.bloomDraw);
    return null;
  }
  if (effect.t === "loseHp") {
    loseLife(m, owner, effect.n, 0);
    note(m, `Paid ${effect.n} life.`);
    return null;
  }
  if (effect.t === "draw") {
    loseLife(m, owner, effect.lose, 1);
    draw(m, owner, effect.n);
    note(m, `Drew ${effect.n}, paid ${effect.lose} life.`);
    return null;
  }
  if (effect.t === "boom") {
    hurt(m, other(owner), 1, null);
    note(m, `${source.name} pings for 1.`);
    return null;
  }
  if (effect.t === "rally") {
    for (const unit of m.players[owner].units) {
      unit.swing += 1;
      if (hasTag(unit, "formation")) {
        unit.hp += 1;
        unit.maxHp += 1;
      }
    }
    note(m, "Rally: +1 attack this turn.");
    return null;
  }
  if (effect.t === "apex") {
    const h = effect.h ?? (effect.plating ? 0 : 1);
    for (const unit of m.players[owner].units) {
      if (unit === self) continue;
      if (cardOf(unit.defId).faction !== "robot") continue;
      unit.hp += h;
      unit.maxHp += h;
      if (effect.plating) {
        unit.plating = (unit.plating ?? 0) + effect.plating;
        unit.plateLeft = (unit.plateLeft ?? 0) + effect.plating;
      }
    }
    note(m, `${source.name} reinforces the line.`);
    return null;
  }
  if (effect.t === "twin") {
    const others = m.players[owner].units.some((unit) => unit !== self && cardOf(unit.defId).faction === "goblin");
    if (others && self) {
      self.atk += 1;
      self.hp += 1;
      self.maxHp += 1;
      note(m, `${source.name} finds a pack.`);
    }
    return null;
  }
  if (effect.t === "hit") return hit(m, effect.n, target);
  if (effect.t === "sweep") {
    for (const foe of m.players[other(owner)].units) damageUnit(foe, effect.n);
    note(m, `${source.name} deals ${effect.n} to every enemy unit.`);
    reap(m);
    return null;
  }
  if (effect.t === "unseal" && !target && source.kind === "unit") return null;
  if (!target || target.kind !== "unit") return "Choose a unit.";
  const unit = findUnit(m, target.uid);
  if (!unit) return "That unit is gone.";
  if (effect.t === "healUnit") {
    if (unit.owner !== owner) return "Heal an ally.";
    unit.hp = Math.min(unit.maxHp, unit.hp + effect.n);
    bloom(m, owner);
    note(m, `${cardOf(unit.defId).name} heals ${effect.n}.`);
    return null;
  }
  if (effect.t === "buff") {
    if (unit.owner !== owner) return "Buff an ally.";
    unit.atk += effect.a;
    unit.hp += effect.h;
    unit.maxHp += effect.h;
    note(m, `${cardOf(unit.defId).name} gets +${effect.a}/+${effect.h}.`);
    return null;
  }
  if (effect.t === "grant") {
    if (unit.owner !== owner) return "Choose an ally.";
    unit.granted = [...(unit.granted ?? []), effect.tag];
    note(m, `${cardOf(unit.defId).name} gains ${effect.tag.charAt(0).toUpperCase() + effect.tag.slice(1)}.`);
    return null;
  }
  if (effect.t === "unseal") {
    unsealUnit(unit);
    note(m, `${cardOf(unit.defId).name} is Unsealed.`);
    if (effect.freezeEnemy && unit.owner !== owner) {
      unit.frozen = true;
      note(m, `${cardOf(unit.defId).name} is frozen.`);
    }
    return null;
  }
  if (effect.t === "freeze") {
    unit.frozen = true;
    note(m, `${cardOf(unit.defId).name} is frozen.`);
    return null;
  }
  if (effect.t === "charge") {
    if (unit.owner !== owner) return "Charge an ally.";
    unit.swing += effect.n ?? 2;
    damageUnit(unit, effect.selfHit ?? 1);
    note(m, `${cardOf(unit.defId).name} charges.`);
    reap(m);
    return null;
  }
  if (effect.t === "overclock") {
    if (unit.owner !== owner || cardOf(unit.defId).faction !== "robot") return "Overclock a Quorin ally.";
    unit.atk += 2;
    unit.hp += 1;
    unit.maxHp += 1;
    unit.sick = false;
    note(m, `${cardOf(unit.defId).name} overclocks.`);
    return null;
  }
  if (effect.t === "grantHaste") {
    if (unit.owner !== owner) return "Give haste to an ally.";
    unit.sick = false;
    note(m, `${cardOf(unit.defId).name} gains haste.`);
    return null;
  }
  return null;
}

/** Tithe choice for `playCard`: true pays, false declines, omitted uses `titheSafe`. */
export type PlayOptions = { tithe?: boolean };

/**
 * The default Tithe rule (also the AI's): pay only if you stay well clear of the
 * damage the rival's board could deal next turn.
 */
export function titheSafe(m: Match, side: Side, n: number): boolean {
  const threat = m.players[other(side)].units
    .filter((unit) => !unit.frozen && !noAttack(unit))
    .reduce((sum, unit) => sum + power(m, unit), 0);
  return m.players[side].hp - n > threat + 4;
}

export function playCard(
  state: Match,
  handUid: string,
  target: Target | null,
  options: PlayOptions = {},
): { state: Match; error?: string } {
  const m = clone(state);
  if (m.phase !== "main" || m.winner) return { state, error: "You can only play cards on your main phase." };
  const seat = m.players[m.turn];
  const hand = seat.hand.find((card) => card.uid === handUid);
  if (!hand) return { state, error: "That card is not in hand." };
  const card = cardOf(hand.defId);
  if (seat.mana < card.cost) return { state, error: "Not enough mana." };
  if (card.kind === "unit" && seat.units.length >= BOARD) return { state, error: "The board is full (6)." };
  if (card.kind === "trap" && seat.traps.length >= TRAPS) return { state, error: "Trap row is full (3)." };
  const optionalTarget =
    card.kind === "unit" && card.play?.t === "unseal" && m.players.every((side) => side.units.length === 0);
  if (needsTarget(card) && !target && !optionalTarget) return { state, error: "Choose a target." };
  if (target?.kind === "unit") {
    const aimed = findUnit(m, target.uid);
    if (!aimed) return { state, error: "That unit is gone." };
    if (!canTarget(m, m.turn, aimed)) return { state, error: `${cardOf(aimed.defId).name} has Veilstep.` };
  }
  if (card.play?.t === "hit" && target && !legalHit(m, target)) return { state, error: "Illegal target." };

  seat.mana -= card.cost;
  seat.hand = seat.hand.filter((cardInHand) => cardInHand.uid !== hand.uid);
  const surging = surgeActive(m);
  m.played = (m.played ?? 0) + 1;
  let spawned: Unit | null = null;
  if (card.kind === "unit") {
    spawned = makeUnit(m, card, m.turn);
    seat.units.push(spawned);
    note(m, `Played ${card.name}.`);
  } else if (card.kind === "trap") {
    seat.traps.push({ uid: uid(m), defId: card.id, owner: m.turn });
    note(m, `Set ${card.name} face down.`);
  } else {
    seat.grave.push(card.id);
    note(m, `Cast ${card.name}.`);
  }
  const err = applyPlay(m, card, m.turn, spawned, target);
  if (err) return { state, error: err };
  if (surging && card.surge && m.winner === null) applySurge(m, card, m.turn, spawned, target);
  if (card.tithe && m.winner === null) {
    const pay = options.tithe ?? titheSafe(m, m.turn, card.tithe.n);
    if (pay && m.players[m.turn].hp > card.tithe.n) applyTithe(m, card, m.turn, spawned);
  }
  syncFormation(m);
  return { state: m };
}

function applyTithe(m: Match, card: CardDef, owner: Side, self: Unit | null): void {
  const tithe = card.tithe;
  if (!tithe) return;
  loseLife(m, owner, tithe.n, 1);
  const effect = tithe.effect;
  if (effect.t === "draw") draw(m, owner, effect.n);
  else if (self && effect.t === "self") {
    self.atk += effect.a;
    self.hp += effect.h;
    self.maxHp += effect.h;
  } else if (self && effect.t === "grant") self.granted = [...(self.granted ?? []), effect.tag];
  note(m, `Tithe: paid ${tithe.n} life for ${card.name}.`);
}

/** True when a card played now would Surge: the current player already played a card this turn. */
export function surgeActive(m: Match): boolean {
  return (m.played ?? 0) > 0;
}

function applySurge(m: Match, card: CardDef, owner: Side, self: Unit | null, target: Target | null): void {
  const effect = card.surge;
  if (!effect) return;
  if (effect.t === "self" && self) {
    self.atk += effect.a;
    self.hp += effect.h;
    self.maxHp += effect.h;
    if (effect.haste) self.sick = false;
  } else if (effect.t === "target" && target?.kind === "unit") {
    const unit = findUnit(m, target.uid);
    if (!unit) return;
    unit.atk += effect.a;
    unit.hp += effect.h;
    unit.maxHp += effect.h;
  } else if (effect.t === "ping") {
    hurt(m, other(owner), effect.n, null);
  } else if (effect.t === "draw") {
    draw(m, owner, effect.n);
  }
  note(m, `Surge: ${card.name}.`);
}

export function endTurn(state: Match): { state: Match; error?: string } {
  const m = clone(state);
  if (m.phase !== "main" || m.winner) return { state, error: "Finish the current step first." };
  m.turn = other(m.turn);
  beginTurn(m);
  return { state: m };
}

export function declareAttack(state: Match, ids: string[]): { state: Match; error?: string } {
  const m = clone(state);
  if (m.phase !== "main" || m.winner) return { state, error: "Not the attack step." };
  if (m.turnCount <= 1) return { state, error: "No attacks on the first turn." };
  if (m.attacked) return { state, error: "You already attacked this turn." };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { state, error: "Choose attackers." };
  for (const id of unique) {
    const unit = findUnit(m, id);
    if (!unit || !canAttack(m, unit)) return { state, error: "One of those units cannot attack." };
    unit.ready = false;
  }
  m.attackers = unique;
  m.attacked = true;
  const defender = other(m.turn);
  const traps = m.players[defender].traps.filter((trap) => cardOf(trap.defId).trap !== "soul");
  m.phase = traps.length ? "trap" : "defend";
  note(m, `${unique.length} attacker${unique.length === 1 ? "" : "s"} declared.`);
  return { state: m };
}

export function skipTrap(state: Match): { state: Match; error?: string } {
  const m = clone(state);
  if (m.phase !== "trap") return { state, error: "No trap window." };
  m.phase = "defend";
  note(m, "Traps stayed down.");
  return { state: m };
}

export function springTrap(state: Match, trapUid: string, targetUid: string | null): { state: Match; error?: string } {
  const m = clone(state);
  if (m.phase !== "trap" || m.winner) return { state, error: "No trap window." };
  const defender = other(m.turn);
  const trap = m.players[defender].traps.find((item) => item.uid === trapUid);
  if (!trap) return { state, error: "That trap is not set." };
  const card = cardOf(trap.defId);
  if (card.trap === "soul") return { state, error: `${card.name} springs on its own.` };
  if (trapNeedsTarget(card.trap) && !targetUid) return { state, error: "Choose an attacker." };
  const attacker = targetUid ? m.attackers.map((id) => findUnit(m, id)).find((unit) => unit?.uid === targetUid) : null;
  if (attacker && !canTarget(m, defender, attacker)) return { state, error: `${cardOf(attacker.defId).name} has Veilstep.` };
  if (card.trap === "pikes") {
    if (!attacker) return { state, error: "Choose an attacker." };
    const n = card.trapN ?? 3;
    damageUnit(attacker, n);
    note(m, `${card.name} deals ${n} to ${cardOf(attacker.defId).name}.`);
  } else if (card.trap === "snare") {
    if (!attacker) return { state, error: "Choose an attacker." };
    const cap = card.trapN ?? 2;
    if (power(m, attacker) > cap) return { state, error: `${card.name} only catches attack ${cap} or less.` };
    attacker.hp = 0;
    note(m, `${card.name} destroys ${cardOf(attacker.defId).name}.`);
  } else if (card.trap === "glade") {
    if (!attacker) return { state, error: "Choose an attacker." };
    healPlayer(m, defender, 2);
    damageUnit(attacker, 1);
    note(m, `${card.name} heals 2 and deals 1.`);
  } else if (card.trap === "firewall") {
    m.players[defender].ward += 4;
    note(m, `${card.name} raises a ward of 4.`);
  } else if (card.trap === "cross") {
    if (!attacker) return { state, error: "Choose an attacker." };
    const n = card.trapN ?? 2;
    damageUnit(attacker, n);
    note(m, `${card.name} deals ${n} to ${cardOf(attacker.defId).name}.`);
  } else if (card.trap === "horizon") {
    if (!attacker) return { state, error: "Choose an attacker." };
    const n = card.trapN ?? 2;
    damageUnit(attacker, n);
    attacker.frozen = true;
    note(m, `${card.name} deals ${n} to ${cardOf(attacker.defId).name} and freezes it.`);
  }
  m.players[defender].traps = m.players[defender].traps.filter((item) => item.uid !== trap.uid);
  m.players[defender].grave.push(card.id);
  reap(m);
  m.attackers = m.attackers.filter((id) => findUnit(m, id));
  m.phase = m.attackers.length ? "defend" : "main";
  if (m.phase === "main") reveal(m);
  if (m.phase === "main") note(m, "The attack breaks.");
  return { state: m };
}

export function assignDefenders(state: Match, blocks: Record<string, string | null>): { state: Match; error?: string } {
  const m = clone(state);
  if (m.phase !== "defend" || m.winner) return { state, error: "Not the block step." };
  const defender = other(m.turn);
  const used = new Set<string>();
  const attackers = m.attackers.map((id) => findUnit(m, id)).filter((unit): unit is Unit => Boolean(unit));
  for (const attacker of attackers) {
    const blockId = blocks[attacker.uid] ?? null;
    if (!blockId) continue;
    if (used.has(blockId)) return { state, error: "A unit can block only one attacker." };
    const blocker = m.players[defender].units.find((unit) => unit.uid === blockId);
    if (!blocker) return { state, error: "That blocker is gone." };
    if (!canBlock(blocker)) return { state, error: "A unit that attacked cannot block until its next turn." };
    used.add(blockId);
  }
  const anyBlock = attackers.some((attacker) => blocks[attacker.uid]);
  if (anyBlock) {
    for (const attacker of attackers) {
      if (hasTag(attacker, "bulwark") && !blocks[attacker.uid]) {
        return { state, error: "Bulwark must be blocked before you block anything else." };
      }
    }
  }
  for (const attacker of attackers) {
    const blockId = blocks[attacker.uid] ?? null;
    const strike = power(m, attacker);
    if (!blockId) {
      const dealt = hurt(m, defender, strike, hasTag(attacker, "drain") ? attacker.owner : null);
      note(m, `${cardOf(attacker.defId).name} hits for ${dealt}.`);
      continue;
    }
    const blocker = m.players[defender].units.find((unit) => unit.uid === blockId);
    if (!blocker) continue;
    const back = power(m, blocker);
    const before = blocker.hp;
    const landed = damageUnit(blocker, strike);
    damageUnit(attacker, back);
    note(m, `${cardOf(attacker.defId).name} trades with ${cardOf(blocker.defId).name}.`);
    if (hasTag(attacker, "crush") && blocker.hp <= 0) {
      const extra = landed - before;
      if (extra > 0) {
        hurt(m, defender, extra, hasTag(attacker, "drain") ? attacker.owner : null);
        note(m, `Crush spills ${extra}.`);
      }
    }
    if (m.winner) break;
  }
  reap(m);
  reveal(m);
  m.attackers = [];
  m.phase = "main";
  return { state: m };
}

/** Attackers lose Veilstep once their attack is over. */
function reveal(m: Match): void {
  for (const id of m.attackers) {
    const unit = findUnit(m, id);
    if (unit) unit.revealed = true;
  }
}

export function attackTraps(m: Match): Trap[] {
  if (m.phase !== "trap") return [];
  return m.players[other(m.turn)].traps.filter((trap) => cardOf(trap.defId).trap !== "soul");
}

export { cardText } from "./card-text";

export function checkRules(): string {
  let m = startMatch("elf", "goblin", 7);
  if (m.players[0].hp !== 20 || m.players[0].manaMax !== 1) throw new Error("open");
  const attackEarly = declareAttack(m, m.players[0].units.map((unit) => unit.uid));
  if (!attackEarly.error) throw new Error("turn 1 attack should fail");
  const fox = CARDS_SAFE("moonpetal");
  m.players[0].hand.push({ uid: "x", defId: fox.id });
  m.players[0].mana = 1;
  const played = playCard(m, "x", null);
  if (played.error) throw new Error(played.error);
  m = played.state;
  if (!m.players[0].units.some((unit) => unit.defId === "moonpetal")) throw new Error("fox");
  const ended = endTurn(m);
  if (ended.error) throw new Error(ended.error);
  m = ended.state;
  if (m.turn !== 1 || m.players[1].manaMax !== 1) throw new Error("rival mana");
  m.phase = "defend";
  m.turn = 0;
  m.attackers = [];
  const dummy = makeUnit(m, cardOf("treant"), 0);
  const chump = makeUnit(m, cardOf("scrap"), 1);
  m.players[0].units = [dummy];
  m.players[1].units = [chump];
  m.attackers = [dummy.uid];
  const bad = assignDefenders(m, {});
  if (bad.error) throw new Error(bad.error);
  const sneak = assignDefenders(
    {
      ...m,
      attackers: [dummy.uid, "a2"],
      players: [
        { ...m.players[0], units: [dummy, { ...chump, uid: "a2", owner: 0, defId: "scrap" }] },
        m.players[1],
      ] as Match["players"],
    },
    { [dummy.uid]: null, a2: chump.uid },
  );
  if (!sneak.error) throw new Error("bulwark should stop a side block");
  const rested = { ...chump, uid: "rested", ready: false };
  const denied = assignDefenders(
    {
      ...m,
      attackers: [dummy.uid],
      players: [{ ...m.players[0], units: [dummy] }, { ...m.players[1], units: [rested] }] as Match["players"],
    },
    { [dummy.uid]: "rested" },
  );
  if (!denied.error) throw new Error("a unit that attacked should not block");
  return "ok";
}

function CARDS_SAFE(id: string): CardDef {
  return cardOf(id);
}
