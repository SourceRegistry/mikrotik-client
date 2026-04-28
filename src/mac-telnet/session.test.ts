import { describe, it, expect } from "vitest";
import {
    createSessionState,
    stageFromState,
    updateByteCounter,
    transitionState,
    createRetransmitEvent,
    resetRetransmit,
    sessionError,
} from "./session";

describe("stageFromState", () => {
    it("maps disconnected to initial", () => {
        expect(stageFromState("disconnected")).toBe("initial");
    });

    it("maps connecting to initial", () => {
        expect(stageFromState("connecting")).toBe("initial");
    });

    it("maps authenticating to auth_response", () => {
        expect(stageFromState("authenticating")).toBe("auth_response");
    });

    it("maps connected to shell", () => {
        expect(stageFromState("connected")).toBe("shell");
    });

    it("maps disconnecting to shell", () => {
        expect(stageFromState("disconnecting")).toBe("shell");
    });

    it("maps error to initial", () => {
        expect(stageFromState("error")).toBe("initial");
    });
});

describe("createSessionState", () => {
    it("creates session in disconnected state", () => {
        const session = createSessionState();

        expect(session.state).toBe("disconnected");
        expect(session.stage).toBe("initial");
        expect(session.byteCounter.sent).toBe(0);
        expect(session.byteCounter.received).toBe(0);
        expect(session.retransmitAttempt).toBe(0);
    });

    it("uses custom session key when provided", () => {
        const session = createSessionState({ sessionKey: 0x1234 });

        expect(session.sessionKey).toBe(0x1234);
    });

    it("generates random session key by default", () => {
        const s1 = createSessionState();
        createSessionState();

        // Very unlikely to collide
        expect(s1.sessionKey).toBeDefined();
        expect(s1.sessionKey).toBeGreaterThanOrEqual(0);
        expect(s1.sessionKey).toBeLessThan(0xffff);
    });

    it("respects custom maxRetransmit", () => {
        const session = createSessionState({ maxRetransmit: 10 });

        expect(session.maxRetransmit).toBe(10);
    });
});

describe("updateByteCounter", () => {
    it("increments sent bytes", () => {
        const session = createSessionState();
        const updated = updateByteCounter(session, 100, "sent");

        expect(updated.byteCounter.sent).toBe(100);
        expect(updated.byteCounter.received).toBe(0);
    });

    it("increments received bytes", () => {
        const session = createSessionState();
        const updated = updateByteCounter(session, 50, "received");

        expect(updated.byteCounter.sent).toBe(0);
        expect(updated.byteCounter.received).toBe(50);
    });

    it("accumulates across multiple calls", () => {
        let session = createSessionState();
        session = updateByteCounter(session, 50, "sent");
        session = updateByteCounter(session, 30, "sent");

        expect(session.byteCounter.sent).toBe(80);
    });

    it("logs bytes_sent event", () => {
        const session = createSessionState();
        const updated = updateByteCounter(session, 200, "sent");

        expect(updated.events).toHaveLength(1);
        expect(updated.events[0].kind).toBe("bytes_sent");
        expect((updated.events[0] as { kind: "bytes_sent"; count: number }).count).toBe(200);
    });

    it("respects maxEvents limit", () => {
        const session = createSessionState({ maxEvents: 3 });
        let s = session;
        for (let i = 0; i < 5; i++) {
            s = updateByteCounter(s, 10, "sent");
        }

        expect(s.events).toHaveLength(3);
    });
});

describe("transitionState", () => {
    it("transitions to new state", () => {
        const session = createSessionState();
        const updated = transitionState(session, "connecting");

        expect(updated.state).toBe("connecting");
    });

    it("updates stage based on new state", () => {
        const session = createSessionState();
        const updated = transitionState(session, "connected");

        expect(updated.state).toBe("connected");
        expect(updated.stage).toBe("shell");
    });

    it("returns same session if state unchanged", () => {
        const session = createSessionState();
        const updated = transitionState(session, "disconnected");

        expect(updated).toBe(session);
    });

    it("logs state_change event", () => {
        const session = createSessionState();
        const updated = transitionState(session, "authenticating");

        expect(updated.events).toHaveLength(1);
        expect(updated.events[0].kind).toBe("state_change");
        const evt = updated.events[0] as { kind: "state_change"; from: string; to: string };
        expect(evt.from).toBe("disconnected");
        expect(evt.to).toBe("authenticating");
    });
});

describe("createRetransmitEvent", () => {
    it("increments retransmit attempt", () => {
        const session = createSessionState();
        const updated = createRetransmitEvent(session, 42);

        expect(updated.retransmitAttempt).toBe(1);
    });

    it("logs retransmit event", () => {
        const session = createSessionState();
        const updated = createRetransmitEvent(session, 100);

        expect(updated.events[0].kind).toBe("retransmit");
        const evt = updated.events[0] as { kind: "retransmit"; sequence: number; attempt: number };
        expect(evt.sequence).toBe(100);
        expect(evt.attempt).toBe(1);
    });

    it("accumulates attempts", () => {
        let session = createSessionState();
        session = createRetransmitEvent(session, 1);
        session = createRetransmitEvent(session, 1);
        session = createRetransmitEvent(session, 1);

        expect(session.retransmitAttempt).toBe(3);
    });
});

describe("resetRetransmit", () => {
    it("resets counter to zero", () => {
        let session = createSessionState();
        session = createRetransmitEvent(session, 1);
        session = createRetransmitEvent(session, 1);

        expect(session.retransmitAttempt).toBe(2);

        const reset = resetRetransmit(session);
        expect(reset.retransmitAttempt).toBe(0);
    });
});

describe("sessionError", () => {
    it("transitions to error state", () => {
        const session = createSessionState();
        const updated = sessionError(session, "Connection timeout");

        expect(updated.state).toBe("error");
        expect(updated.stage).toBe("initial");
    });

    it("logs error event", () => {
        let session = createSessionState();
        session = transitionState(session, "connected");
        const updated = sessionError(session, "Socket error");

        const errorEvent = updated.events.find((e) => e.kind === "error");
        expect(errorEvent).toBeDefined();
        expect((errorEvent as { kind: "error"; message: string }).message).toBe("Socket error");
    });

    it("records original state in error event", () => {
        let session = createSessionState();
        session = transitionState(session, "authenticating");
        const updated = sessionError(session, "Auth failed");

        const errorEvent = updated.events.find((e) => e.kind === "error");
        expect((errorEvent as { kind: "error"; state: string }).state).toBe("authenticating");
    });
});
