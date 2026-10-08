package info.chainlens.magicmoney;

import org.junit.Test;
import static org.junit.Assert.assertArrayEquals;

public class DappViewportInsetsTest {
    @Test public void boundedPageDoesNotReceiveWindowBars() {
        assertArrayEquals(new int[] {0, 0}, DappViewportInsets.intersect(120, 600, 850, 24, 48));
    }
    @Test public void onlyActualOverlapIsForwarded() {
        assertArrayEquals(new int[] {14, 0}, DappViewportInsets.intersect(10, 600, 850, 24, 48));
        assertArrayEquals(new int[] {0, 18}, DappViewportInsets.intersect(120, 700, 850, 24, 48));
    }
    @Test public void keyboardOverlapAndDismissalUpdate() {
        assertArrayEquals(new int[] {0, 170}, DappViewportInsets.intersect(120, 600, 850, 24, 300));
        assertArrayEquals(new int[] {0, 0}, DappViewportInsets.intersect(120, 400, 850, 24, 300));
        assertArrayEquals(new int[] {0, 0}, DappViewportInsets.intersect(120, 600, 850, 24, 0));
    }
    @Test public void sideCutoutsAndEmptyBounds() {
        assertArrayEquals(new int[] {0, 20}, DappViewportInsets.intersect(20, 380, 400, 20, 20));
        assertArrayEquals(new int[] {0, 0}, DappViewportInsets.intersect(0, 0, 850, 24, 48));
    }
}
