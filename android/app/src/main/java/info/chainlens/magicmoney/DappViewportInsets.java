package info.chainlens.magicmoney;

/** Intersect a window-edge inset with an embedded viewport, in native pixels. */
final class DappViewportInsets {
    private DappViewportInsets() { }

    static int[] intersect(int start, int size, int windowSize, int before, int after) {
        int length = Math.max(0, size);
        return new int[] {
            Math.min(length, Math.max(0, before - start)),
            Math.min(length, Math.max(0, start + length - (windowSize - after)))
        };
    }
}
