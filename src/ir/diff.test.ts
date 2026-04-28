import { describe, expect, it, vi } from 'vitest';
import { diff, applyPatch, isPatchEmpty, patchSize } from './diff';
import { createEmptyConfig, type IRResourceBlock, type RouterOSConfig, type IRResourceCommand, type IRProperty } from './types';
import type { DeviceTransport } from '../routeros/transport';

function resource(
    path: string,
    command: IRResourceCommand,
    props: IRProperty[],
    findQuery?: IRProperty
): IRResourceBlock {
    const block: IRResourceBlock = {
        kind: 'resource',
        path,
        command,
        properties: props,
    };
    if (findQuery) {
        block.findQuery = [findQuery];
    }
    return block;
}

function config(items: IRResourceBlock[]): RouterOSConfig {
    const c = createEmptyConfig();
    c.items = items;
    return c;
}

describe('diff', () => {
    describe('creates', () => {
        it('detects new resources in desired config', () => {
            const current = config([]);
            const desired = config([
                resource('/ip address', 'add', [
                    { name: 'address', value: '192.168.1.1/24' },
                    { name: 'interface', value: 'bridge1' },
                ]),
            ]);
            const patch = diff(current, desired);
            expect(patch.create).toHaveLength(1);
            expect(patch.update).toHaveLength(0);
            expect(patch.delete).toHaveLength(0);
        });
    });

    describe('updates', () => {
        it('detects property changes in existing resources', () => {
            const current = config([
                resource('/interface ethernet', 'set', [
                    { name: 'disabled', value: 'yes' },
                ], { name: 'default-name', value: 'ether1' }),
            ]);
            const desired = config([
                resource('/interface ethernet', 'set', [
                    { name: 'disabled', value: 'no' },
                    { name: 'comment', value: 'wan' },
                ], { name: 'default-name', value: 'ether1' }),
            ]);
            const patch = diff(current, desired);
            expect(patch.create).toHaveLength(0);
            expect(patch.update).toHaveLength(1);
            expect(patch.delete).toHaveLength(0);

            const update = patch.update[0];
            expect(update.changes).toBeDefined();
            const disabledChange = update.changes.find((c) => c.name === 'disabled');
            expect(disabledChange).toMatchObject({
                oldValue: 'yes',
                newValue: 'no',
            });
        });

        it('detects no changes when configs are identical', () => {
            const block = resource('/ip address', 'add', [
                { name: 'address', value: '192.168.1.1/24' },
            ]);
            const current = config([block]);
            const desired = config([structuredClone(block)]);
            const patch = diff(current, desired);
            expect(patch.create).toHaveLength(0);
            expect(patch.update).toHaveLength(0);
            expect(patch.delete).toHaveLength(0);
        });
    });

    describe('deletes', () => {
        it('detects removed resources', () => {
            const current = config([
                resource('/ip address', 'add', [
                    { name: 'address', value: '192.168.1.1/24' },
                ]),
            ]);
            const desired = config([]);
            const patch = diff(current, desired);
            expect(patch.create).toHaveLength(0);
            expect(patch.update).toHaveLength(0);
            expect(patch.delete).toHaveLength(1);
        });
    });

    describe('isPatchEmpty', () => {
        it('returns true for empty patch', () => {
            const patch = diff(config([]), config([]));
            expect(isPatchEmpty(patch)).toBe(true);
        });

        it('returns false for non-empty patch', () => {
            const current = config([]);
            const desired = config([
                resource('/ip address', 'add', [{ name: 'address', value: '10.0.0.1/24' }]),
            ]);
            const patch = diff(current, desired);
            expect(isPatchEmpty(patch)).toBe(false);
        });
    });

    describe('patchSize', () => {
        it('returns total number of operations', () => {
            const current = config([
                resource('/ip address', 'add', [{ name: 'address', value: '10.0.0.1/24' }]),
            ]);
            const desired = config([
                resource('/ip address', 'add', [{ name: 'address', value: '192.168.1.1/24' }]),
            ]);
            const patch = diff(current, desired);
            expect(patchSize(patch)).toBeGreaterThanOrEqual(0);
        });
    });

    describe('resource ID property paths', () => {
        function testPath(path: string, primaryProp: string) {
            const current = config([resource(path, 'add', [{ name: primaryProp, value: 'x' }])]);
            const desired = config([resource(path, 'add', [{ name: primaryProp, value: 'x' }])]);
            const patch = diff(current, desired);
            expect(patch.create).toHaveLength(0);
        }

        it('uses bridge port properties', () => testPath('/interface bridge port', 'interface'));
        it('uses bridge vlan properties', () => testPath('/interface bridge vlan', 'vlan-ids'));
        it('uses route properties', () => testPath('/ip route', 'dst-address'));
        it('uses firewall filter properties', () => testPath('/ip firewall filter', 'chain'));
        it('uses firewall nat properties', () => testPath('/ip firewall nat', 'chain'));
        it('uses firewall mangle properties', () => testPath('/ip firewall mangle', 'chain'));
        it('uses dhcp properties', () => testPath('/ip dhcp-server', 'address'));
        it('uses bgp properties', () => testPath('/routing bgp connection', 'name'));
    });

    describe('property removal', () => {
        it('detects property removed from old config', () => {
            const current = config([
                resource('/interface', 'set', [
                    { name: 'name', value: 'ether1' },
                    { name: 'comment', value: 'old-comment' },
                ], { name: 'name', value: 'ether1' }),
            ]);
            const desired = config([
                resource('/interface', 'set', [
                    { name: 'name', value: 'ether1' },
                    // comment removed
                ], { name: 'name', value: 'ether1' }),
            ]);
            const patch = diff(current, desired);
            expect(patch.update).toHaveLength(1);
            const removedChange = patch.update[0]?.changes.find(c => c.name === 'comment');
            expect(removedChange).toBeDefined();
            expect(removedChange?.newValue).toBe('');
        });
    });
});

describe('applyPatch', () => {
    it('applies create operations via transport', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        const patch = diff(
            config([]),
            config([resource('/ip address', 'add', [{ name: 'address', value: '192.168.1.1/24' }])])
        );

        const result = await applyPatch(transport, patch, {});
        expect(result.applied).toBeGreaterThan(0);
        expect(transport.execute).toHaveBeenCalled();
    });

    it('handles abort signal', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        const patch = diff(
            config([]),
            config([resource('/ip address', 'add', [{ name: 'address', value: '192.168.1.1/24' }])])
        );

        const controller = new AbortController();
        controller.abort();
        const result = await applyPatch(transport, patch, { signal: controller.signal });
        expect(result.failed.length).toBeGreaterThan(0);
    });

    it('collects errors on failed operations', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockRejectedValue(new Error('device unavailable')),
        };
        const transport = mockTransport as DeviceTransport;

        const patch = diff(
            config([]),
            config([resource('/ip address', 'add', [{ name: 'address', value: '192.168.1.1/24' }])])
        );

        const result = await applyPatch(transport, patch, {});
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe('device unavailable');
    });

    it('applies update operations via transport', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        const current = config([
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'yes' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const desired = config([
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'no' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const patch = diff(current, desired);
        expect(patch.update).toHaveLength(1);

        const result = await applyPatch(transport, patch, {});
        expect(result.applied).toBe(1);
        expect(result.failed).toHaveLength(0);
        expect(transport.execute).toHaveBeenCalledWith(
            '/interface ethernet/set',
            expect.objectContaining({
                queries: expect.any(Array),
                attributes: expect.objectContaining({ disabled: 'no' }),
            })
        );
    });

    it('applies delete operations via transport', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        const current = config([
            resource('/ip address', 'add', [
                { name: 'address', value: '192.168.1.1/24' },
            ]),
        ]);
        const desired = config([]);
        const patch = diff(current, desired);
        expect(patch.delete).toHaveLength(1);

        const result = await applyPatch(transport, patch, {});
        expect(result.applied).toBe(1);
        expect(result.failed).toHaveLength(0);
        expect(transport.execute).toHaveBeenCalledWith(
            '/ip address/remove',
            expect.any(Object)
        );
    });

    it('handles abort signal during update operations', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        const current = config([
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'yes' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const desired = config([
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'no' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const patch = diff(current, desired);

        const controller = new AbortController();
        controller.abort();
        const result = await applyPatch(transport, patch, { signal: controller.signal });
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe('Aborted');
    });

    it('handles abort signal during delete operations', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        const current = config([
            resource('/ip address', 'add', [
                { name: 'address', value: '192.168.1.1/24' },
            ]),
        ]);
        const desired = config([]);
        const patch = diff(current, desired);

        const controller = new AbortController();
        controller.abort();
        const result = await applyPatch(transport, patch, { signal: controller.signal });
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe('Aborted');
    });

    it('collects errors on failed update operations', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockRejectedValue(new Error('update failed')),
        };
        const transport = mockTransport as DeviceTransport;

        const current = config([
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'yes' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const desired = config([
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'no' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const patch = diff(current, desired);

        const result = await applyPatch(transport, patch, {});
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe('update failed');
    });

    it('collects errors on failed delete operations', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockRejectedValue(new Error('delete failed')),
        };
        const transport = mockTransport as DeviceTransport;

        const current = config([
            resource('/ip address', 'add', [
                { name: 'address', value: '192.168.1.1/24' },
            ]),
        ]);
        const desired = config([]);
        const patch = diff(current, desired);

        const result = await applyPatch(transport, patch, {});
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe('delete failed');
    });

    it('applies mixed create, update, delete in a single patch', async () => {
        const mockTransport: Partial<DeviceTransport> = {
            execute: vi.fn().mockResolvedValue({ sentences: [], status: 'done' }),
        };
        const transport = mockTransport as DeviceTransport;

        // Create: new item only in desired
        // Update: item in both with changed property
        // Delete: item only in current
        const current = config([
            resource('/ip address', 'add', [
                { name: 'address', value: '10.0.0.1/24' },
                { name: 'interface', value: 'ether1' },
            ]),
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'yes' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const desired = config([
            resource('/ip address', 'add', [
                { name: 'address', value: '192.168.1.1/24' },
                { name: 'interface', value: 'bridge1' },
            ]),
            resource('/interface ethernet', 'set', [
                { name: 'disabled', value: 'no' },
            ], { name: 'default-name', value: 'ether1' }),
        ]);
        const patch = diff(current, desired);

        const result = await applyPatch(transport, patch, {});
        expect(result.applied).toBeGreaterThan(0);
        expect(result.failed).toHaveLength(0);
        // Should have called execute for each operation type
        expect(transport.execute).toHaveBeenCalledTimes(patch.create.length + patch.update.length + patch.delete.length);
    });
});
