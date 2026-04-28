import { describe, expect, it } from 'vitest';
import { parseExport } from './parse';
import { isResourceBlock, isComment, isSystemCommand, isBlock } from './types';

describe('parseExport', () => {
    describe('empty input', () => {
        it('returns empty config for empty string', () => {
            const config = parseExport('');
            expect(config.items).toHaveLength(0);
            expect(config.identity).toBeUndefined();
        });

        it('returns empty config for whitespace only', () => {
            const config = parseExport('   \n\n   ');
            expect(config.items).toHaveLength(0);
        });
    });

    describe('comments', () => {
        it('parses # style comments', () => {
            const config = parseExport('# this is a comment');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isComment(first)).toBe(true);
            if (isComment(first)) {
                expect(first.text).toContain('this is a comment');
            }
        });

        it('parses // style comments', () => {
            const config = parseExport('// this is a comment');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isComment(first)).toBe(true);
        });

        it('parses /* block */ comments', () => {
            const config = parseExport('/* block comment */');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isComment(first)).toBe(true);
        });

        it('parses multiline /* block */ comments', () => {
            const config = parseExport('/* line one\nline two */');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isComment(first)).toBe(true);
        });

        it('preserves comments between resource blocks', () => {
            const config = parseExport(`
        # interfaces section
        /interface ethernet set [find default-name=ether1] disabled=no
        # ip section
        /ip address add address=192.168.1.1/24 interface=bridge1
      `);
            const comments = config.items.filter((item) => isComment(item));
            expect(comments).toHaveLength(2);
        });
    });

    describe('resource blocks', () => {
        it('parses a simple /ip address add', () => {
            const config = parseExport('/ip address add address=192.168.1.1/24 interface=bridge1');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isResourceBlock(first)).toBe(true);
            if (!isResourceBlock(first)) return;
            expect(first.path).toBe('/ip address');
            expect(first.command).toBe('add');
            const addrProp = first.properties.find((p) => p.name === 'address');
            expect(addrProp).toHaveProperty('value', '192.168.1.1/24');
            const ifaceProp = first.properties.find((p) => p.name === 'interface');
            expect(ifaceProp).toHaveProperty('value', 'bridge1');
        });

        it('parses set with [find ...] query', () => {
            const config = parseExport(
                '/interface ethernet set [find default-name=ether1] disabled=no comment=wan'
            );
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isResourceBlock(first)).toBe(true);
            if (!isResourceBlock(first)) return;
            expect(first.command).toBe('set');
            expect(first.findQuery).toHaveLength(1);
            expect(first.findQuery![0]).toEqual({ name: 'default-name', value: 'ether1' });
        });

        it('parses remove with [find ...] query', () => {
            const config = parseExport('/ip firewall filter remove [find comment="old rule"]');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isResourceBlock(first)).toBe(true);
            if (!isResourceBlock(first)) return;
            expect(first.command).toBe('remove');
            expect(first.findQuery).toBeDefined();
        });

        it('parses multiple resource blocks', () => {
            const config = parseExport(`
        /interface bridge add name=bridge1
        /interface bridge port add interface=ether1 bridge=bridge1
        /ip address add address=192.168.1.1/24 interface=bridge1
      `);
            const resources = config.items.filter((item) => isResourceBlock(item));
            expect(resources).toHaveLength(3);
        });

        it('parses resource blocks with quoted values', () => {
            const config = parseExport('/interface ethernet set [find default-name=ether1] comment="my interface"');
            const [first] = config.items;
            expect(isResourceBlock(first)).toBe(true);
            if (!isResourceBlock(first)) return;
            const commentProp = first.properties.find((p) => p.name === 'comment');
            expect(commentProp?.value).toBe('my interface');
        });

        it('parses resource blocks with escaped quotes in values', () => {
            const config = parseExport('/interface ethernet set [find default-name=ether1] comment="my \\"quoted\\" interface"');
            const [first] = config.items;
            expect(isResourceBlock(first)).toBe(true);
            if (!isResourceBlock(first)) return;
            const commentProp = first.properties.find((p) => p.name === 'comment');
            expect(commentProp?.value).toBe('my "quoted" interface');
        });
    });

    describe('system commands', () => {
        it('parses :delay command', () => {
            const config = parseExport(':delay 1s');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isSystemCommand(first)).toBe(true);
        });

        it('parses :put command', () => {
            const config = parseExport(':put "hello"');
            expect(config.items).toHaveLength(1);
            const [first] = config.items;
            expect(isSystemCommand(first)).toBe(true);
        });
    });

    describe('block groupings', () => {
        it('parses { } block with items', () => {
            const config = parseExport(`
        /interface bridge {
          add name=bridge1
          add name=bridge2
        }
      `);
            const blocks = config.items.filter((item) => isBlock(item));
            expect(blocks).toHaveLength(1);
            expect(blocks[0].items).toHaveLength(2);
        });
    });

    describe('identity extraction', () => {
        it('extracts identity from /system identity set', () => {
            const config = parseExport('/system identity set name=my-router');
            expect(config.identity).toBe('my-router');
        });

        it('does not extract identity from other paths', () => {
            const config = parseExport('/system clock set time-zone-name=UTC');
            expect(config.identity).toBeUndefined();
        });
    });

    describe('preserveBlankLines', () => {
        it('preserves blank lines when option is true', () => {
            const config = parseExport('line1\n\nline2', { preserveBlankLines: true });
            // Blank lines become empty comments
            const blankComments = config.items.filter(
                (item) => isComment(item) && item.text === ''
            );
            expect(blankComments.length).toBeGreaterThan(0);
        });

        it('skips blank lines by default', () => {
            const config = parseExport('line1\n\nline2');
            const blankComments = config.items.filter(
                (item) => isComment(item) && item.text === ''
            );
            expect(blankComments).toHaveLength(0);
        });
    });
});
