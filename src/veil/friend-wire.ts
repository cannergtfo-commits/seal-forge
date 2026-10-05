import Peer, { type DataConnection } from "peerjs";
import type { Faction } from "./cards";
import { applySeat, clockMs, expireMatch, flipAct, flipMatch, type SeatAct } from "./direct";
import { startMatch, type Match } from "./logic";
import { ownsStage } from "./stages";

export type Hello = { name: string; faction: Faction; deck: string[] | null; address?: string; stage?: number };

export type FriendFrame = {
  match: Match;
  leftMs: number;
  rivalName: string;
  rivalFaction: Faction;
  stage: number;
};

type Hooks = {
  onFrame: (frame: FriendFrame) => void;
  onStatus: (text: string) => void;
  onClose: () => void;
};

const ice = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function makePeer(id?: string): Peer {
  const options = {
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    secure: true,
    config: ice,
    debug: 0,
  };
  return id ? new Peer(id, options) : new Peer(options);
}

function blame(error: unknown): string {
  const type = typeof error === "object" && error && "type" in error ? String(error.type) : "";
  if (type === "unavailable-id") return "That code is already in use. Host again.";
  if (type === "peer-unavailable") return "No table is using that code.";
  if (type === "network" || type === "server-error" || type === "socket-error") return "Could not reach the table service.";
  if (type === "disconnected") return "The table connection dropped.";
  return "The table connection failed.";
}

export function friendId(code: string): string {
  return `sf${code.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

async function held(address: string | undefined, dropId: number | undefined): Promise<boolean> {
  if (!address || !dropId) return false;
  return ownsStage(address, dropId);
}

async function resolveStage(host: Hello, guest: Hello): Promise<number> {
  if (await held(host.address, host.stage)) return host.stage ?? 0;
  if (await held(guest.address, guest.stage)) return guest.stage ?? 0;
  return 0;
}

async function confirmStage(me: Hello, host: string, claimed: number): Promise<number> {
  if (!claimed) return 0;
  if (await held(host, claimed)) return claimed;
  if (await held(me.address, claimed)) return claimed;
  return 0;
}

export function hostFriend(code: string, me: Hello, hooks: Hooks): { send: (action: SeatAct) => void; close: () => void } {
  const peer = makePeer(friendId(code));
  let conn: DataConnection | null = null;
  let match: Match | null = null;
  let guest: Hello | null = null;
  let stage = 0;
  let timer = 0;
  let shut = false;

  function stop() {
    window.clearTimeout(timer);
  }

  function publish(next: Match) {
    if (!guest) return;
    match = next;
    stop();
    const leftMs = clockMs(next);
    hooks.onFrame({ match: next, leftMs, rivalName: guest.name, rivalFaction: guest.faction, stage });
    conn?.send({ t: "state", match: next, leftMs, name: me.name, faction: me.faction, stage, host: me.address ?? "" });
    if (next.winner !== null) return;
    timer = window.setTimeout(() => {
      if (!match || match !== next) return;
      const expired = expireMatch(next);
      if (expired) publish(expired);
    }, leftMs);
  }

  function apply(seat: 0 | 1, action: SeatAct) {
    if (!match) return;
    const result = applySeat(match, seat, action);
    if (result.error) {
      hooks.onStatus(result.error);
      return;
    }
    publish(result.state);
  }

  peer.on("open", () => hooks.onStatus("Waiting for a rival."));
  peer.on("error", (error) => hooks.onStatus(blame(error)));
  peer.on("connection", (incoming) => {
    if (conn) {
      incoming.close();
      return;
    }
    conn = incoming;
    incoming.on("data", (raw) => {
      const data = raw as { t?: string; name?: string; faction?: Faction; deck?: string[] | null; address?: string; stage?: number; action?: SeatAct };
      if (data.t === "join" && data.faction && !match) {
        guest = { name: (data.name || "Rival").slice(0, 24), faction: data.faction, deck: data.deck ?? null, address: data.address, stage: data.stage };
        const seed = Math.floor(Math.random() * 0xffffffff) || 1;
        const opened = startMatch(me.faction, guest.faction, seed, [me.deck, guest.deck]);
        void resolveStage(me, guest).then((chosen) => {
          stage = chosen;
          publish(opened);
        });
        return;
      }
      if (data.t === "act" && data.action && match) apply(1, flipAct(data.action));
    });
    incoming.on("close", () => {
      if (!shut) hooks.onClose();
    });
  });

  return {
    send: (action) => apply(0, action),
    close: () => {
      if (shut) return;
      shut = true;
      stop();
      conn?.close();
      peer.destroy();
    },
  };
}

export function joinFriend(code: string, me: Hello, hooks: Hooks): { send: (action: SeatAct) => void; close: () => void } {
  const peer = makePeer();
  let conn: DataConnection | null = null;
  let shut = false;
  let stagePromise: Promise<number> | null = null;

  function close() {
    if (shut) return;
    shut = true;
    conn?.close();
    peer.destroy();
  }

  peer.on("error", (error) => hooks.onStatus(blame(error)));
  peer.on("open", () => {
    const link = peer.connect(friendId(code), { reliable: true });
    conn = link;
    link.on("open", () => {
      hooks.onStatus("Sitting down.");
      link.send({ t: "join", name: me.name, faction: me.faction, deck: me.deck, address: me.address, stage: me.stage });
    });
    link.on("data", (raw) => {
      const data = raw as { t?: string; match?: Match; leftMs?: number; name?: string; faction?: Faction; stage?: number; host?: string };
      if (data.t === "state" && data.match && data.faction) {
        const claimed = Number(data.stage) || 0;
        const host = data.host ?? "";
        stagePromise ??= confirmStage(me, host, claimed);
        void stagePromise.then((stage) => {
          hooks.onFrame({
            match: flipMatch(data.match as Match),
            leftMs: data.leftMs ?? clockMs(data.match as Match),
            rivalName: data.name || "Rival",
            rivalFaction: data.faction as Faction,
            stage,
          });
        });
      }
    });
    link.on("close", () => {
      if (!shut) hooks.onClose();
    });
    link.on("error", () => hooks.onStatus("The table connection failed."));
  });

  return {
    send: (action) => conn?.send({ t: "act", action }),
    close,
  };
}

type Wire = { send: (action: SeatAct) => void; close: () => void };

/** Pairs the phone app and the browser on the same public lanes. */
export function seekRival(me: Hello, hooks: Hooks, waitMs = 20_000): { send: (action: SeatAct) => void; close: () => void } {
  let shut = false;
  let live: Wire | null = null;
  const hostSlot: Wire[] = [];
  const started = Date.now();
  const order = [0, 1, 2, 3, 4];
  const spin = Math.floor(Math.random() * order.length);
  const lanes = order.map((index) => order[(index + spin) % order.length]).map((lane) => `q${me.faction}${lane}`);

  function left() {
    return Math.max(0, waitMs - (Date.now() - started));
  }

  function claim(wire: Wire) {
    live = wire;
  }

  function attemptJoin(code: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (shut || live) {
        resolve(false);
        return;
      }
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      const wire = joinFriend(code, me, {
        onFrame: (frame) => {
          if (live && live !== wire) {
            wire.close();
            finish(false);
            return;
          }
          claim(wire);
          hooks.onFrame(frame);
          finish(true);
        },
        onStatus: (text) => {
          if (text.includes("No table") || text.includes("failed") || text.includes("reach") || text.includes("dropped")) {
            wire.close();
            finish(false);
            return;
          }
          if (text !== "Sitting down.") hooks.onStatus(text);
        },
        onClose: () => {
          if (live === wire) hooks.onClose();
          else finish(false);
        },
      });
      window.setTimeout(() => {
        if (done) return;
        if (live !== wire) wire.close();
        finish(false);
      }, ms);
    });
  }

  function attemptHost(code: string, ms: number): Promise<"seated" | "taken" | "empty"> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: "seated" | "taken" | "empty") => {
        if (done) return;
        done = true;
        resolve(value);
      };
      const wire = hostFriend(code, me, {
        onFrame: (frame) => {
          claim(wire);
          hooks.onFrame(frame);
          finish("seated");
        },
        onStatus: (text) => {
          if (text.includes("already in use")) {
            wire.close();
            hostSlot.pop();
            finish("taken");
            return;
          }
          if (text !== "Waiting for a rival.") hooks.onStatus(text);
        },
        onClose: () => {
          if (live === wire) hooks.onClose();
        },
      });
      hostSlot[0] = wire;
      window.setTimeout(() => {
        if (done || live === wire) return;
        wire.close();
        hostSlot.pop();
        finish("empty");
      }, ms);
    });
  }

  void (async () => {
    const mine = lanes[0] ?? "qelf0";
    const hosted = attemptHost(mine, Math.max(1000, left()));
    for (const lane of lanes.slice(1)) {
      if (shut || live) break;
      if (await attemptJoin(lane, Math.min(3000, left()))) {
        hostSlot.pop()?.close();
        return;
      }
    }
    const result = await hosted;
    if (result === "taken" && !live && (await attemptJoin(mine, Math.min(4000, left())))) return;
    if (!shut && !live) hooks.onStatus("No rival answered.");
  })();

  return {
    send: (action) => live?.send(action),
    close: () => {
      shut = true;
      hostSlot.pop()?.close();
      live?.close();
      live = null;
    },
  };
}
