export type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });

    return {promise, resolve, reject};
}

export function encodeLength(length: number): Buffer {
    if (!Number.isInteger(length) || length < 0) {
        throw new RangeError(`Invalid RouterOS word length: ${length}`);
    }

    if (length <= 0x7f) {
        return Buffer.from([length]);
    }

    if (length <= 0x3fff) {
        const value = length | 0x8000;
        return Buffer.from([(value >> 8) & 0xff, value & 0xff]);
    }

    if (length <= 0x1fffff) {
        const value = length | 0xc00000;
        return Buffer.from([
            (value >> 16) & 0xff,
            (value >> 8) & 0xff,
            value & 0xff,
        ]);
    }

    if (length <= 0x0fffffff) {
        const value = length | 0xe0000000;
        return Buffer.from([
            (value >> 24) & 0xff,
            (value >> 16) & 0xff,
            (value >> 8) & 0xff,
            value & 0xff,
        ]);
    }

    return Buffer.from([
        0xf0,
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
    ]);
}

export function decodeLength(
    buffer: Buffer,
    offset = 0
): { length: number; bytesRead: number } | undefined {
    if (offset >= buffer.length) {
        return undefined;
    }

    const first = buffer[offset];

    if (first < 0x80) {
        return {length: first, bytesRead: 1};
    }

    if (first < 0xc0) {
        if (offset + 2 > buffer.length) return undefined;
        const value = ((first << 8) | buffer[offset + 1]) & 0x3fff;
        return {length: value, bytesRead: 2};
    }

    if (first < 0xe0) {
        if (offset + 3 > buffer.length) return undefined;
        const value =
            ((first << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2]) &
            0x1fffff;
        return {length: value, bytesRead: 3};
    }

    if (first < 0xf0) {
        if (offset + 4 > buffer.length) return undefined;
        const value =
            ((first << 24) |
                (buffer[offset + 1] << 16) |
                (buffer[offset + 2] << 8) |
                buffer[offset + 3]) >>>
            0;
        return {length: value & 0x0fffffff, bytesRead: 4};
    }

    if (first === 0xf0) {
        if (offset + 5 > buffer.length) return undefined;
        const value =
            ((buffer[offset + 1] << 24) |
                (buffer[offset + 2] << 16) |
                (buffer[offset + 3] << 8) |
                buffer[offset + 4]) >>>
            0;
        return {length: value, bytesRead: 5};
    }

    throw new Error(`Reserved RouterOS control byte encountered: 0x${first.toString(16)}`);
}

export function encodeWord(word: string): Buffer {
    const content = Buffer.from(word, "utf8");
    return Buffer.concat([encodeLength(content.length), content]);
}

export function encodeSentence(words: readonly string[]): Buffer {
    const buffers = words.map((word) => encodeWord(word));
    buffers.push(Buffer.from([0]));
    return Buffer.concat(buffers);
}

export class SentenceDecoder {
    private buffer: Buffer = Buffer.alloc(0);
    private currentWords: string[] = [];

    push(chunk: Uint8Array): string[][] {
        const chunkBuffer = Buffer.from(chunk);
        this.buffer =
            this.buffer.length === 0
                ? chunkBuffer
                : Buffer.concat([this.buffer, chunkBuffer]);
        const sentences: string[][] = [];
        let offset = 0;

        while (offset < this.buffer.length) {
            const decoded = decodeLength(this.buffer, offset);
            if (!decoded) break;

            if (offset + decoded.bytesRead + decoded.length > this.buffer.length) {
                break;
            }

            offset += decoded.bytesRead;
            const word = this.buffer.subarray(offset, offset + decoded.length);
            offset += decoded.length;

            if (decoded.length === 0) {
                sentences.push(this.currentWords);
                this.currentWords = [];
                continue;
            }

            this.currentWords.push(word.toString("utf8"));
        }

        this.buffer = this.buffer.subarray(offset);
        return sentences;
    }
}

export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
    message: string,
    onTimeout?: () => void
): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) return promise;

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout?.();
            reject(new Error(message));
        }, timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
