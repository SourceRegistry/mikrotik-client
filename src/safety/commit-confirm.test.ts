import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitConfirm, type CommitConfirmHandle } from './commit-confirm';
import type { DeviceTransport } from '../routeros/transport';

function createMockTransport(): DeviceTransport {
    return {
        execute: vi.fn().mockResolvedValue(undefined),
        print: vi.fn().mockResolvedValue([]),
        listen: vi.fn().mockResolvedValue({
            on: vi.fn(),
            off: vi.fn(),
            destroy: vi.fn(),
            [Symbol.asyncIterator]: vi.fn(),
        }),
    };
}

describe('commitConfirm', () => {
    let transport: DeviceTransport;
    let mockFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        transport = createMockTransport();
        mockFn = vi.fn().mockResolvedValue(undefined);
    });

    it('saves backup before executing fn', async () => {
        await commitConfirm({
            transport,
            fn: mockFn,
        });

        expect(transport.execute).toHaveBeenCalledWith('/export', expect.any(Object));
        expect(mockFn).toHaveBeenCalledWith(transport);
    });

    it('schedules auto-revert after fn executes', async () => {
        await commitConfirm({
            transport,
            fn: mockFn,
        });

        const calls = transport.execute.mock.calls;
        const schedulerCall = calls.find(
            (call) => call[0] === '/system/scheduler/add'
        );
        expect(schedulerCall).toBeDefined();
        expect(schedulerCall![1].attributes['on-event']).toMatch(/^\/import file=pre-/);
    });

    it('returns handle with txid and deadline', async () => {
        const handle: CommitConfirmHandle = await commitConfirm({
            transport,
            fn: mockFn,
            windowSeconds: 60,
        });

        expect(handle.txid).toBeDefined();
        expect(handle.deadlineMs).toBeGreaterThan(Date.now());
        expect(handle.isSettled()).toBe(false);
    });

    it('confirm removes scheduler and cleanup', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
            cleanupAfterConfirm: true,
        });

        expect(transport.execute).toHaveBeenCalledTimes(2); // export + scheduler

        await handle.confirm();

        const executeCalls = transport.execute.mock.calls;
        const schedulerRemove = executeCalls.find(
            (call) => call[0] === '/system/scheduler/remove'
        );
        expect(schedulerRemove).toBeDefined();

        expect(handle.isSettled()).toBe(true);
    });

    it('confirm skips backup cleanup when cleanupAfterConfirm is false', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
            cleanupAfterConfirm: false,
        });

        await handle.confirm();

        // Should only remove scheduler, not backup
        const executeCalls = transport.execute.mock.calls;
        const backupRemoves = executeCalls.filter(
            (call) => call[0] === '/file/remove'
        );
        expect(backupRemoves).toHaveLength(0);
    });

    it('rollback imports backup and cleans up', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
        });

        await handle.rollback();

        const executeCalls = transport.execute.mock.calls;
        const importCall = executeCalls.find((call) => call[0] === '/import');
        expect(importCall).toBeDefined();

        const schedulerRemove = executeCalls.find(
            (call) => call[0] === '/system/scheduler/remove'
        );
        expect(schedulerRemove).toBeDefined();

        expect(handle.isSettled()).toBe(true);
    });

    it('unsafeDirectApply skips backup and scheduler', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
            unsafeDirectApply: true,
        });

        expect(mockFn).toHaveBeenCalledWith(transport);
        expect(transport.execute).not.toHaveBeenCalled();
        expect(handle.isSettled()).toBe(true);
    });

    it('dispose performs best-effort cleanup', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
        });

        await handle.dispose();

        const executeCalls = transport.execute.mock.calls;
        const schedulerRemove = executeCalls.find(
            (call) => call[0] === '/system/scheduler/remove'
        );
        expect(schedulerRemove).toBeDefined();
        expect(handle.isSettled()).toBe(true);
    });

    it('confirm is idempotent', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
        });

        await handle.confirm();
        const callsAfterFirst = transport.execute.mock.calls.length;
        await handle.confirm();

        expect(transport.execute.mock.calls.length).toBe(callsAfterFirst);
    });

    it('rollback is idempotent', async () => {
        const handle = await commitConfirm({
            transport,
            fn: mockFn,
        });

        await handle.rollback();
        const callsAfterFirst = transport.execute.mock.calls.length;
        await handle.rollback();

        expect(transport.execute.mock.calls.length).toBe(callsAfterFirst);
    });

    it('cleans up backup when fn throws', async () => {
        const throwingFn = vi.fn().mockRejectedValue(new Error('mutation failed'));

        await expect(
            commitConfirm({ transport, fn: throwingFn })
        ).rejects.toThrow('mutation failed');

        // export backup was saved, then removed on failure
        const calls = transport.execute.mock.calls;
        expect(calls.some((c) => c[0] === '/export')).toBe(true);
        expect(calls.some((c) => c[0] === '/file/remove')).toBe(true);
        // scheduler must NOT have been created
        expect(calls.some((c) => c[0] === '/system/scheduler/add')).toBe(false);
    });
});
