/**
 * @module mac-telnet/session
 *
 * Session state machine for MAC-Telnet protocol.
 *
 * Tracks connection lifecycle, byte counters, and retransmission state.
 *
 * @example
 * ```ts
 * const session = createSessionState();
 * session = updateByteCounter(session, 100);
 * const stage = stageFromState(session);
 * ```
 */

// ── Session States ───────────────────────────────────────────────────────────

/**
 * High-level session lifecycle states.
 */
export type SessionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "disconnecting"
  | "error";

/**
 * Session stage strings used in control packets.
 */
export type SessionStage = "initial" | "auth_request" | "auth_response" | "authenticated" | "shell";

// ── Byte Counter ─────────────────────────────────────────────────────────────

/**
 * Byte counter state for MAC-Telnet packet sequencing.
 */
export interface ByteCounter {
  /** Total bytes sent. */
  sent: number;
  /** Total bytes received. */
  received: number;
  /** Last sequence number used. */
  lastSequence: number;
}

// ── Session Event ────────────────────────────────────────────────────────────

/**
 * Event emitted during session lifecycle.
 */
export type SessionEvent =
  | { kind: "state_change"; from: SessionState; to: SessionState }
  | { kind: "bytes_sent"; count: number; total: number }
  | { kind: "bytes_received"; count: number; total: number }
  | { kind: "retransmit"; sequence: number; attempt: number }
  | { kind: "error"; message: string; state: SessionState };

// ── Session Object ───────────────────────────────────────────────────────────

/**
 * Full session tracking state.
 */
export interface MacTelnetSession {
  /** Current lifecycle state. */
  state: SessionState;
  /** Current auth/data stage. */
  stage: SessionStage;
  /** Session key (16-bit, unique per session). */
  sessionKey: number;
  /** Byte counter for sent/received tracking. */
  byteCounter: ByteCounter;
  /** Current retransmit attempt (0 = none). */
  retransmitAttempt: number;
  /** Max retransmit attempts before giving up. */
  maxRetransmit: number;
  /** Event log (most recent first). */
  events: SessionEvent[];
  /** Max events to keep in log. */
  maxEvents: number;
}

// ── State → Stage Mapping ───────────────────────────────────────────────────

/**
 * Derive the session stage from the current lifecycle state.
 *
 * | State           | Stage         |
 * |-----------------|---------------|
 * | disconnected    | initial       |
 * | connecting      | initial       |
 * | authenticating  | auth_request  |
 * | connected       | shell         |
 * | disconnecting   | shell         |
 * | error           | initial       |
 *
 * @param state - Current session lifecycle state.
 * @returns Corresponding session stage.
 *
 * @example
 * ```ts
 * stageFromState("authenticating"); // → "auth_response"
 * ```
 */
export function stageFromState(state: SessionState): SessionStage {
  switch (state) {
    case "disconnected":
    case "connecting":
    case "error":
      return "initial";
    case "authenticating":
      return "auth_response";
    case "connected":
    case "disconnecting":
      return "shell";
  }
}

// ── Session Creation ────────────────────────────────────────────────────────

/**
 * Create a fresh session state object.
 *
 * @param opts - Optional overrides for session key and retransmit limits.
 * @returns New session in "disconnected" state.
 *
 * @example
 * ```ts
 * const session = createSessionState({ sessionKey: 0x1234 });
 * ```
 */
export function createSessionState(opts?: {
  sessionKey?: number;
  maxRetransmit?: number;
  maxEvents?: number;
}): MacTelnetSession {
  const sessionKey = opts?.sessionKey ?? Math.floor(Math.random() * 0xffff);
  return {
    state: "disconnected",
    stage: "initial",
    sessionKey,
    byteCounter: { sent: 0, received: 0, lastSequence: 0 },
    retransmitAttempt: 0,
    maxRetransmit: opts?.maxRetransmit ?? 5,
    events: [],
    maxEvents: opts?.maxEvents ?? 100,
  };
}

// ── Byte Counter Updates ────────────────────────────────────────────────────

/**
 * Update the byte counter after sending data.
 *
 * @param session - Current session state.
 * @param bytes - Number of bytes sent.
 * @returns Updated session with incremented counters and event logged.
 *
 * @example
 * ```ts
 * session = updateByteCounter(session, packetBytes.length);
 * ```
 */
export function updateByteCounter(
  session: MacTelnetSession,
  bytes: number,
  direction: "sent" | "received" = "sent"
): MacTelnetSession {
  const updated = { ...session };

  if (direction === "sent") {
    updated.byteCounter = { ...session.byteCounter, sent: session.byteCounter.sent + bytes };
  } else {
    updated.byteCounter = {
      ...session.byteCounter,
      received: session.byteCounter.received + bytes,
    };
  }

  const event: SessionEvent =
    direction === "sent"
      ? { kind: "bytes_sent", count: bytes, total: updated.byteCounter.sent }
      : { kind: "bytes_received", count: bytes, total: updated.byteCounter.received };

  updated.events = [event, ...session.events].slice(0, session.maxEvents);

  return updated;
}

// ── State Transitions ───────────────────────────────────────────────────────

/**
 * Transition the session to a new state, logging the change.
 *
 * @param session - Current session.
 * @param newState - Target state.
 * @returns Updated session.
 *
 * @example
 * ```ts
 * session = transitionState(session, "connected");
 * ```
 */
export function transitionState(
  session: MacTelnetSession,
  newState: SessionState
): MacTelnetSession {
  if (session.state === newState) {
    return session;
  }

  const updated = { ...session, state: newState, stage: stageFromState(newState) };
  const event: SessionEvent = {
    kind: "state_change",
    from: session.state,
    to: newState,
  };
  updated.events = [event, ...session.events].slice(0, session.maxEvents);
  return updated;
}

// ── Event Creation ──────────────────────────────────────────────────────────

/**
 * Create and append a retransmit event.
 *
 * @param session - Current session.
 * @param sequence - Sequence number being retransmitted.
 * @returns Updated session with event logged.
 */
export function createRetransmitEvent(
  session: MacTelnetSession,
  sequence: number
): MacTelnetSession {
  const attempt = session.retransmitAttempt + 1;
  const updated = { ...session, retransmitAttempt: attempt };
  const event: SessionEvent = {
    kind: "retransmit",
    sequence,
    attempt,
  };
  updated.events = [event, ...session.events].slice(0, session.maxEvents);
  return updated;
}

/**
 * Reset retransmit counter (after ACK received).
 */
export function resetRetransmit(session: MacTelnetSession): MacTelnetSession {
  return { ...session, retransmitAttempt: 0 };
}

// ── Error Handling ──────────────────────────────────────────────────────────

/**
 * Record an error event and transition to error state.
 *
 * @param session - Current session.
 * @param message - Error description.
 * @returns Session in "error" state with event logged.
 */
export function sessionError(session: MacTelnetSession, message: string): MacTelnetSession {
  const event: SessionEvent = { kind: "error", message, state: session.state };
  const updated = transitionState(session, "error");
  updated.events = [event, ...updated.events].slice(0, updated.maxEvents);
  return updated;
}
