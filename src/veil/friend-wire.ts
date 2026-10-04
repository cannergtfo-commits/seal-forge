import Peer, { type DataConnection } from "peerjs";
import type { Faction } from "./cards";
import { applySeat, clockMs, expireMatch, flipAct, flipMatch, type SeatAct } from "./direct";
import { startMatch, type Match } from "./logic";

export type Hello = { name: string; faction: Faction; deck: string[] | null };

export type FriendFrame = {
  match: Match;
  leftMs: number;
  rivalName: string;
  rivalFaction: Faction;
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

export function hostFriend(code: string, me: Hello, hooks: Hooks): { send: (action: SeatAct) => void; close: () => void } {
  const peer = makePeer(friendId(code));
  let conn: DataConnection | null = null;
  let match: Match | null = null;
  let guest: Hello | null = null;
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
    hooks.onFrame({ match: next, leftMs, rivalName: guest.name, rivalFaction: guest.faction });
    conn?.send({ t: "state", match: next, leftMs, name: me.name, faction: me.faction });
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
      const data = raw as { t?: string; name?: string; faction?: Faction; deck?: string[] | null; action?: SeatAct };
      if (data.t === "join" && data.faction && !match) {
        guest = { name: (data.name || "Rival").slice(0, 24), faction: data.faction, deck: data.deck ?? null };
        const seed = Math.floor(Math.random() * 0xffffffff) || 1;
        publish(startMatch(me.faction, guest.faction, seed, [me.deck, guest.deck]));
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

  function close() {
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
      link.send({ t: "join", name: me.name, faction: me.faction, deck: me.deck });
    });
    link.on("data", (raw) => {
      const data = raw as { t?: string; match?: Match; leftMs?: number; name?: string; faction?: Faction };
      if (data.t === "state" && data.match && data.faction) {
        hooks.onFrame({
          match: flipMatch(data.match),
          leftMs: data.leftMs ?? clockMs(data.match),
          rivalName: data.name || "Rival",
          rivalFaction: data.faction,
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
